use actix_web::{web, HttpResponse};
use async_stream::stream;
use tokio::sync::broadcast;

use super::types::*;
use crate::npc::defs::{THOMAS, MARCUS, DIANE, RAY, CHAD};
use crate::npc::types::NpcDef;

pub async fn handle_options() -> HttpResponse {
    HttpResponse::Ok()
        .insert_header(("Access-Control-Allow-Origin", "*"))
        .insert_header(("Access-Control-Allow-Methods", "GET, POST, OPTIONS"))
        .insert_header(("Access-Control-Allow-Headers", "Content-Type"))
        .finish()
}

pub async fn handle_npc_message(
    npc_map: web::Data<NpcMap>,
    body: web::Json<NpcMessageBody>,
) -> HttpResponse {
    let map = npc_map.lock().unwrap();
    if let Some(state_arc) = map.get(&body.npc_id) {
        let mut npc = state_arc.lock().unwrap();
        let msg = body.message.trim().to_string();
        if !msg.is_empty() && msg.len() <= 200 {
            eprintln!("[player->{}] {} says: \"{}\"", body.npc_id, body.player_name, msg);
            npc.message_queue.push((body.player_id.clone(), body.player_name.clone(), msg));
        }
        HttpResponse::Ok().json(serde_json::json!({ "queued": true }))
    } else {
        HttpResponse::NotFound().json(serde_json::json!({ "error": "NPC not found" }))
    }
}

pub async fn handle_npc_state(
    npc_map: web::Data<NpcMap>,
    query: web::Query<NpcStateQuery>,
) -> HttpResponse {
    let map = npc_map.lock().unwrap();
    if let Some(state_arc) = map.get(&query.npc_id) {
        let npc = state_arc.lock().unwrap();
        let memory_summary: std::collections::HashMap<&String, Vec<&String>> =
            npc.memory.iter().map(|(k,v)| (k, v.iter().collect())).collect();
        HttpResponse::Ok().json(serde_json::json!({
            "npc_id": query.npc_id,
            "position": [npc.pos.0, npc.pos.1, npc.pos.2],
            "emotion": npc.emotion,
            "action_type": npc.current_action.action_type,
            "speech": npc.current_action.message,
            "memory": memory_summary,
            "message_queue_len": npc.message_queue.len(),
        }))
    } else {
        HttpResponse::NotFound().json(serde_json::json!({ "error": "NPC not found" }))
    }
}

pub async fn handle_npc_events(
    broadcast_tx: web::Data<broadcast::Sender<String>>,
) -> HttpResponse {
    let mut rx = broadcast_tx.subscribe();
    let s = stream! {
        loop {
            match rx.recv().await {
                Ok(msg) => yield Ok::<_, actix_web::Error>(
                    actix_web::web::Bytes::from(format!("data: {}\n\n", msg))
                ),
                Err(_) => break,
            }
        }
    };
    HttpResponse::Ok()
        .content_type("text/event-stream")
        .insert_header(("Cache-Control", "no-cache"))
        .insert_header(("X-Accel-Buffering", "no"))
        .streaming(s)
}

pub async fn handle_npc_context(
    npc_map: web::Data<NpcMap>,
    body: web::Json<NpcContextBody>,
) -> HttpResponse {
    let map = npc_map.lock().unwrap();
    if let Some(state_arc) = map.get(&body.npc_id) {
        let mut npc = state_arc.lock().unwrap();
        npc.nearby_items = body.nearby_items.iter().map(|i| (i.id.clone(), i.dist)).collect();
        npc.held_item = body.held_item.clone();
        if let Some(trust) = body.player_trust {
            npc.trust_level.insert(body.npc_id.clone(), trust);
        }
        HttpResponse::Ok().json(serde_json::json!({ "ok": true }))
    } else {
        HttpResponse::NotFound().json(serde_json::json!({ "error": "NPC not found" }))
    }
}

pub async fn handle_player_update(
    players: web::Data<SharedPlayers>,
    body: web::Json<PlayerUpdateBody>,
) -> HttpResponse {
    let mut ps = players.lock().unwrap();
    if let Some(p) = ps.iter_mut().find(|p| p.id == body.id) {
        p.pos = body.pos; p.name = body.name.clone();
    } else {
        ps.push(PlayerInfo { id: body.id.clone(), name: body.name.clone(), pos: body.pos });
    }
    HttpResponse::Ok().json(serde_json::json!({ "ok": true }))
}

pub async fn handle_player_leave(
    players: web::Data<SharedPlayers>,
    body: web::Json<PlayerLeaveBody>,
) -> HttpResponse {
    players.lock().unwrap().retain(|p| p.id != body.id);
    HttpResponse::Ok().json(serde_json::json!({ "ok": true }))
}

// ── TTS endpoint: POST /npc-tts  { npc_id, text } → MP3 audio stream ─────────
// Browser sends the NPC's speech text; server streams ElevenLabs audio back.

#[derive(serde::Deserialize)]
pub struct NpcTtsBody {
    pub npc_id: String,
    pub text: String,
}

pub async fn handle_npc_tts(
    body: web::Json<NpcTtsBody>,
    el_key: web::Data<String>,
) -> HttpResponse {
    use futures_util::StreamExt as _;

    let voice_id = match body.npc_id.as_str() {
        "thomas" => "29vD33N1CtxCmqQRPOHJ",
        "marcus" => "TxGEqnHWrfWFTfGW9XjX",
        "diane"  => "EXAVITQu4vr4xnSDxMaL",
        "ray"    => "VR6AewLTigWG4xSOukaG",
        "chad"   => "N2lVS1w4EtoT3dr4eOWO",
        _        => "21m00Tcm4TlvDq8ikWAM",
    };

    let text = body.text.trim().to_string();
    if text.is_empty() {
        return HttpResponse::BadRequest().body("empty text");
    }

    let el_url = format!("https://api.elevenlabs.io/v1/text-to-speech/{}/stream", voice_id);
    let req_body = serde_json::json!({
        "text": text,
        "model_id": "eleven_turbo_v2_5",
        "voice_settings": { "stability": 0.45, "similarity_boost": 0.8, "style": 0.4, "use_speaker_boost": true }
    });

    let http = reqwest::Client::builder().use_rustls_tls().build().unwrap();
    let resp = match http.post(&el_url)
        .header("xi-api-key", el_key.get_ref().as_str())
        .header("Content-Type", "application/json")
        .header("Accept", "audio/mpeg")
        .json(&req_body)
        .send().await
    {
        Ok(r) => r,
        Err(e) => { eprintln!("[tts] ElevenLabs request failed: {e}"); return HttpResponse::InternalServerError().body("tts failed"); }
    };

    if !resp.status().is_success() {
        eprintln!("[tts] ElevenLabs HTTP {}", resp.status());
        return HttpResponse::BadGateway().body("elevenlabs error");
    }

    // Stream MP3 bytes directly back to the browser
    let stream = resp.bytes_stream().map(|r| r.map_err(|e| {
        actix_web::error::ErrorInternalServerError(e)
    }));

    HttpResponse::Ok()
        .content_type("audio/mpeg")
        .insert_header(("Cache-Control", "no-cache"))
        .streaming(stream)
}
