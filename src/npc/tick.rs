use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::sleep;

use super::bedrock::{AwsCreds, call_bedrock};
use super::types::{NpcDef, NpcState, fallback_action, coerce_memory_updates};
use crate::http::types::{PlayerInfo, SharedPlayers};

fn build_user_prompt(
    state: &NpcState,
    nearby_players: &[PlayerInfo],
    queued_messages: &[(String, String, String)],
) -> String {
    let mut p = format!(
        "Your position: ({:.0}, {:.0}, {:.0})\nEmotion: {}\nAction: {}\n\n",
        state.pos.0, state.pos.1, state.pos.2,
        state.emotion, state.current_action.action_type
    );

    if nearby_players.is_empty() {
        p.push_str("No players nearby.\n\n");
    } else {
        p.push_str("Nearby players:\n");
        for pl in nearby_players.iter().take(5) {
            let dx = pl.pos[0] - state.pos.0;
            let dz = pl.pos[2] - state.pos.2;
            let dist = (dx*dx + dz*dz).sqrt();
            p.push_str(&format!("  - {} (id:{}): {:.1} blocks\n", pl.name, pl.id, dist));
        }
        p.push('\n');
        p.push_str("Memory:\n");
        for pl in nearby_players.iter().take(5) {
            match state.memory.get(&pl.id) {
                Some(facts) if !facts.is_empty() =>
                    p.push_str(&format!("  - {}: \"{}\"\n", pl.name, facts.join("; "))),
                _ => p.push_str(&format!("  - {}: (first meeting)\n", pl.name)),
            }
        }
        p.push('\n');
    }

    if !queued_messages.is_empty() {
        p.push_str("Messages:\n");
        for (pid, pname, msg) in queued_messages {
            let safe: String = msg.chars()
                .map(|c| if c == '[' {'('} else if c == ']' {')'} else {c})
                .take(200).collect();
            p.push_str(&format!("  [PLAYER:{}] {} says: {}\n", pid, pname, safe));
        }
        p.push('\n');
    }

    if state.nearby_items.is_empty() {
        p.push_str("Ground items nearby: none\n\n");
    } else {
        p.push_str("Ground items nearby:\n");
        for (id, dist) in &state.nearby_items {
            p.push_str(&format!("  - {} at {:.1} blocks\n", id, dist));
        }
        p.push('\n');
    }
    if let Some(ref item) = state.held_item {
        p.push_str(&format!("You are holding: {}\n\n", item));
    }

    p.push_str("Decide your next action.\n");
    p
}

pub async fn run_npc_tick(
    def: &'static NpcDef,
    npc_arc: Arc<Mutex<NpcState>>,
    players: SharedPlayers,
    creds: Arc<AwsCreds>,
    http: reqwest::Client,
    broadcast_tx: tokio::sync::broadcast::Sender<String>,
) {
    loop {
        sleep(Duration::from_millis(300)).await;

        let (has_messages, in_flight, nearby_count, time_since_last) = {
            let npc = npc_arc.lock().unwrap();
            let all = players.lock().unwrap();
            let count = all.iter().filter(|p| {
                let dx = p.pos[0] - npc.pos.0;
                let dz = p.pos[2] - npc.pos.2;
                (dx*dx + dz*dz).sqrt() < def.nearby_radius
            }).count();
            let elapsed = npc.last_autonomous_tick.elapsed().as_millis() as u64;
            (!npc.message_queue.is_empty(), npc.tick_in_flight, count, elapsed)
        };

        if in_flight { continue; }

        // Check for players newly entering greeting radius (~4 blocks)
        let greeting_trigger: Option<(String, String)> = {
            let mut npc = npc_arc.lock().unwrap();
            let all = players.lock().unwrap();
            let mut trigger = None;
            for p in all.iter() {
                let dx = p.pos[0] - npc.pos.0;
                let dz = p.pos[2] - npc.pos.2;
                let dist = (dx*dx + dz*dz).sqrt();
                if dist < 4.0 && !npc.greeted_players.contains(&p.id) {
                    npc.greeted_players.insert(p.id.clone());
                    trigger = Some((p.id.clone(), p.name.clone()));
                    break;
                }
                // Remove from greeted if they walk away (>8 blocks) so they get greeted again on return
                if dist > 8.0 {
                    npc.greeted_players.remove(&p.id);
                }
            }
            trigger
        };

        let has_greeting = greeting_trigger.is_some();
        if let Some((pid, pname)) = greeting_trigger {
            let mut npc = npc_arc.lock().unwrap();
            npc.message_queue.push((
                pid,
                pname,
                "[SYSTEM: This player just walked up to you. Acknowledge them briefly in character.]".to_string(),
            ));
        }

        // Only tick when there's a message — no autonomous chatter
        if !has_messages && !has_greeting { continue; }

        let (queued_msgs, pos, emotion) = {
            let mut npc = npc_arc.lock().unwrap();
            if npc.tick_in_flight { continue; }
            npc.tick_in_flight = true;
            let msgs = std::mem::take(&mut npc.message_queue);
            (msgs, npc.pos, npc.emotion.clone())
        };

        let nearby: Vec<PlayerInfo> = {
            let npc = npc_arc.lock().unwrap();
            let all = players.lock().unwrap();
            all.iter().filter(|p| {
                let dx = p.pos[0] - npc.pos.0;
                let dz = p.pos[2] - npc.pos.2;
                (dx*dx + dz*dz).sqrt() < def.nearby_radius
            }).cloned().collect()
        };

        let user_prompt = {
            let npc = npc_arc.lock().unwrap();
            build_user_prompt(&npc, &nearby, &queued_msgs)
        };

        let result = call_bedrock(&creds, &http, def.personality_prompt, &user_prompt).await;

        let (new_action, new_emotion, memory_updates) = match result {
            Ok(llm) => {
                let action = if llm.action.action_type == "move_to_waypoint" {
                    let wp = llm.action.waypoint.as_deref().unwrap_or("");
                    if def.waypoints.iter().any(|(n,_)| *n == wp) {
                        llm.action
                    } else {
                        eprintln!("[{}] Invalid waypoint '{}', falling back", def.id, wp);
                        fallback_action()
                    }
                } else { llm.action };
                (action, llm.emotion, coerce_memory_updates(llm.memory_updates))
            }
            Err(e) => {
                eprintln!("[{}] Bedrock error: {}", def.id, e);
                (fallback_action(), emotion, HashMap::new())
            }
        };

        let new_pos = if new_action.action_type == "move_to_waypoint" {
            let wp = new_action.waypoint.as_deref().unwrap_or("");
            def.waypoints.iter().find(|(n,_)| *n == wp).map(|(_,p)| *p).unwrap_or(pos)
        } else if new_action.action_type == "move_toward" {
            let all = players.lock().unwrap();
            all.iter().min_by_key(|p| {
                let dx = p.pos[0] - pos.0; let dz = p.pos[2] - pos.2;
                ((dx*dx + dz*dz) * 1000.0) as i64
            }).map(|p| (p.pos[0], pos.1, p.pos[2])).unwrap_or(pos)
        } else if new_action.action_type == "move_away" {
            def.waypoints.iter().find(|(n,_)| *n == "tent")
                .map(|(_,p)| *p).unwrap_or(pos)
        } else { pos };

        let direction = {
            let dx = new_pos.0 - pos.0; let dz = new_pos.2 - pos.2;
            let len = (dx*dx + dz*dz).sqrt();
            if len > 0.01 { (dx/len, 0.0f32, dz/len) } else { (0.0, 0.0, 1.0) }
        };

        {
            let mut npc = npc_arc.lock().unwrap();
            npc.pos = new_pos;
            npc.direction = direction;
            npc.emotion = new_emotion.clone();
            npc.current_action = new_action.clone();
            npc.tick_in_flight = false;
            npc.last_autonomous_tick = std::time::Instant::now();
            for (player_id, update) in memory_updates {
                match update {
                    Some(fact) => {
                        let entry = npc.memory.entry(player_id).or_default();
                        entry.push(fact);
                        if entry.len() > 10 { entry.remove(0); }
                    }
                    None => { npc.memory.remove(&player_id); }
                }
            }
        }

        let broadcast = serde_json::json!({
            "npc_id": def.id,
            "name": def.name,
            "position": [new_pos.0, new_pos.1, new_pos.2],
            "direction": [direction.0, direction.1, direction.2],
            "emotion": new_emotion,
            "action_type": new_action.action_type,
            "speech": new_action.message,
            "speech_target": new_action.target_player,
            "waypoint": new_action.waypoint,
        });
        if let Ok(json) = serde_json::to_string(&broadcast) {
            eprintln!("[{}] {}", def.id, &json[..json.len().min(200)]);
            let _ = broadcast_tx.send(json);
        }
    }
}
