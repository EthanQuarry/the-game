use actix_web::{web, HttpResponse};
use async_stream::stream;
use tokio::sync::broadcast;

use super::types::*;
use crate::npc::defs::{THOMAS, MARCUS, DIANE, RAY};
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

// ── Voice handler (OpenAI Realtime → ElevenLabs TTS) ─────────────────────────

pub async fn handle_npc_voice(
    req: actix_web::HttpRequest,
    stream: web::Payload,
    npc_map: web::Data<NpcMap>,
    openai_key: web::Data<String>,
    el_key: web::Data<String>,
) -> actix_web::Result<HttpResponse> {
    use tokio_tungstenite::tungstenite::protocol::Message as TMsg;
    use futures_util::{SinkExt, StreamExt};

    let npc_id = req.query_string().split('&')
        .find_map(|p| p.strip_prefix("npc_id=")).unwrap_or("thomas").to_string();
    let player_name = req.query_string().split('&')
        .find_map(|p| p.strip_prefix("player_name=")).unwrap_or("Player")
        .replace('+', " ").to_string();

    struct VoiceCfg { el_voice_id: &'static str, style: &'static str }
    let vcfg: VoiceCfg = match npc_id.as_str() {
        "thomas" => VoiceCfg { el_voice_id: "29vD33N1CtxCmqQRPOHJ",
            style: "Tired, a bit slurred, trails off. Rough but human. 1-2 sentences." },
        "marcus" => VoiceCfg { el_voice_id: "TxGEqnHWrfWFTfGW9XjX",
            style: "Calm, cold, street-smart. Short sentences. 1-2 sentences." },
        "diane"  => VoiceCfg { el_voice_id: "EXAVITQu4vr4xnSDxMaL",
            style: "Tired but sharp bodega owner. Impatient but kind. 1-2 sentences." },
        "ray"    => VoiceCfg { el_voice_id: "VR6AewLTigWG4xSOukaG",
            style: "Weary pawnshop owner. Dry, deadpan. 1-2 sentences." },
        _        => VoiceCfg { el_voice_id: "21m00Tcm4TlvDq8ikWAM", style: "" },
    };

    let defs: &[&NpcDef] = &[&THOMAS, &MARCUS, &DIANE, &RAY];
    let personality = {
        let map = npc_map.lock().unwrap();
        if map.contains_key(&npc_id) {
            defs.iter().find(|d| d.id == npc_id)
                .map(|d| d.personality_prompt.to_string())
                .unwrap_or_else(|| "You are a helpful NPC.".to_string())
        } else { "You are a helpful NPC.".to_string() }
    };

    let system_prompt = format!(
        "{}\n\n{}\n\nYou are speaking with {}. Keep responses to 1-2 sentences — real-time voice.",
        personality, vcfg.style, player_name
    );
    let el_voice_id = vcfg.el_voice_id.to_string();

    let (response, mut session, mut client_stream) = actix_ws::handle(&req, stream)?;
    let openai_key = openai_key.get_ref().clone();
    let el_key = el_key.get_ref().clone();

    actix_web::rt::spawn(async move {
        use tokio_tungstenite::connect_async;
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;

        let url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17";
        let mut openai_req = url.into_client_request().unwrap();
        openai_req.headers_mut().insert("Authorization", format!("Bearer {}", openai_key).parse().unwrap());
        openai_req.headers_mut().insert("OpenAI-Beta", "realtime=v1".parse().unwrap());

        let (openai_ws, _) = match connect_async(openai_req).await {
            Ok(r) => r,
            Err(e) => { eprintln!("[voice] OpenAI connect failed: {e}"); let _ = session.close(None).await; return; }
        };
        let (mut openai_sink, mut openai_stream) = openai_ws.split();

        let session_update = serde_json::json!({
            "type": "session.update",
            "session": {
                "modalities": ["text"],
                "instructions": system_prompt,
                "input_audio_format": "pcm16",
                "input_audio_transcription": { "model": "whisper-1" },
                "turn_detection": { "type": "server_vad", "threshold": 0.5,
                    "prefix_padding_ms": 300, "silence_duration_ms": 600 }
            }
        });
        let _ = openai_sink.send(TMsg::Text(session_update.to_string())).await;

        let mut openai_sink2 = openai_sink;
        actix_web::rt::spawn(async move {
            while let Some(Ok(msg)) = client_stream.next().await {
                match msg {
                    actix_ws::Message::Binary(b) => {
                        let encoded = base64_encode(&b);
                        let event = serde_json::json!({ "type": "input_audio_buffer.append", "audio": encoded });
                        if openai_sink2.send(TMsg::Text(event.to_string())).await.is_err() { break; }
                    }
                    actix_ws::Message::Close(_) => break,
                    _ => {}
                }
            }
            let _ = openai_sink2.close().await;
        });

        let http_client = reqwest::Client::builder().use_rustls_tls().build().unwrap();
        let mut accumulated_text = String::new();

        while let Some(Ok(TMsg::Text(raw))) = openai_stream.next().await {
            let ev: serde_json::Value = match serde_json::from_str(&raw) { Ok(v) => v, Err(_) => continue };
            let ev_type = ev["type"].as_str().unwrap_or("");

            if ev_type == "response.text.delta" {
                if let Some(delta) = ev["delta"].as_str() {
                    accumulated_text.push_str(delta);
                    let msg = serde_json::json!({ "type": "transcript.delta", "delta": delta });
                    if session.text(msg.to_string()).await.is_err() { break; }
                }
            }

            if ev_type == "response.text.done" {
                if let Some(text) = ev["text"].as_str() { accumulated_text = text.to_string(); }
                if accumulated_text.is_empty() { continue; }
                let text_to_speak = std::mem::take(&mut accumulated_text);

                let el_url = format!("https://api.elevenlabs.io/v1/text-to-speech/{}/stream", el_voice_id);
                let body = serde_json::json!({
                    "text": text_to_speak,
                    "model_id": "eleven_turbo_v2_5",
                    "voice_settings": { "stability": 0.4, "similarity_boost": 0.8, "style": 0.5, "use_speaker_boost": true }
                });

                let el_resp = match http_client.post(&el_url)
                    .header("xi-api-key", &el_key)
                    .header("Content-Type", "application/json")
                    .header("Accept", "audio/mpeg")
                    .json(&body).send().await
                {
                    Ok(r) => r,
                    Err(e) => { eprintln!("[voice] ElevenLabs failed: {e}"); continue; }
                };
                if !el_resp.status().is_success() { eprintln!("[voice] ElevenLabs {}", el_resp.status()); continue; }

                if session.text(serde_json::json!({"type":"audio.start"}).to_string()).await.is_err() { break; }
                let mut resp_stream = el_resp.bytes_stream();
                use futures_util::StreamExt as _;
                while let Some(Ok(chunk)) = resp_stream.next().await {
                    if session.binary(chunk).await.is_err() { break; }
                }
                if session.text(serde_json::json!({"type":"audio.done"}).to_string()).await.is_err() { break; }
            }
        }
        let _ = session.close(None).await;
    });

    Ok(response)
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARS[((n >> 18) & 0x3f) as usize] as char);
        out.push(CHARS[((n >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 { out.push(CHARS[((n >> 6) & 0x3f) as usize] as char); } else { out.push('='); }
        if chunk.len() > 2 { out.push(CHARS[(n & 0x3f) as usize] as char); } else { out.push('='); }
    }
    out
}
