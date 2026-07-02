use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use voxelize::{ClientFilter, Event, World};

pub const MAX_HP: i32 = 100;

pub fn register_handlers(world: &mut World, player_hp: Arc<Mutex<HashMap<String, i32>>>) {
    {
        let hp_hit = Arc::clone(&player_hp);
        world.set_event_handle("player-hit", move |world, _sender_id, payload| {
            let v: serde_json::Value = match serde_json::from_str(payload) {
                Ok(v) => v, Err(_) => return,
            };
            let target_id = match v["target_id"].as_str() {
                Some(s) => s.to_owned(), None => return,
            };
            let damage = v["damage"].as_i64().unwrap_or(10) as i32;

            let new_hp = {
                let mut map = hp_hit.lock().unwrap();
                let hp = map.entry(target_id.clone()).or_insert(MAX_HP);
                *hp = (*hp - damage).max(0);
                *hp
            };
            let killed = new_hp == 0;

            world.events_mut().dispatch(
                Event::new("health-update")
                    .payload(serde_json::json!({
                        "player_id": target_id,
                        "hp": new_hp,
                        "max_hp": MAX_HP,
                        "killed": killed,
                    }))
                    .filter(ClientFilter::All)
                    .build(),
            );

            if killed {
                let mut map = hp_hit.lock().unwrap();
                map.insert(target_id.clone(), MAX_HP);
                world.events_mut().dispatch(
                    Event::new("player-respawned")
                        .payload(serde_json::json!({
                            "player_id": target_id,
                            "hp": MAX_HP,
                            "max_hp": MAX_HP,
                        }))
                        .filter(ClientFilter::All)
                        .build(),
                );
            }
        });
    }

    {
        let hp_respawn = Arc::clone(&player_hp);
        world.set_event_handle("player-respawn", move |world, client_id, _payload| {
            { let mut map = hp_respawn.lock().unwrap(); map.insert(client_id.to_owned(), MAX_HP); }
            world.events_mut().dispatch(
                Event::new("health-update")
                    .payload(serde_json::json!({
                        "player_id": client_id,
                        "hp": MAX_HP,
                        "max_hp": MAX_HP,
                        "killed": false,
                    }))
                    .filter(ClientFilter::All)
                    .build(),
            );
        });
    }
}
