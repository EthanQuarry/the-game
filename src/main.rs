use dotenvy::dotenv;
use actix_web::{web, App, HttpServer};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use voxelize::{
    Block, FlatlandStage,
    Registry, Server, Voxelize, World, WorldConfig,
};

mod world;
mod npc;
mod http;
mod health;

use npc::bedrock::AwsCreds;
use npc::defs::{THOMAS, MARCUS, DIANE, CHAD};
use npc::types::{NpcDef, NpcState, fallback_action};
use npc::tick::run_npc_tick;
use http::types::{NpcMap, PlayerInfo, SharedPlayers};
use http::handlers::*;
use world::CityStage;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenv().ok();
    let _ = rustls::crypto::ring::default_provider().install_default();

    // ── Block registry ────────────────────────────────────────────────────────
    let dirt            = Block::new("Dirt").id(1).build();
    let stone           = Block::new("Stone").id(2).build();
    let grass           = Block::new("Grass Block").id(3).build();
    let brick           = Block::new("Brick").id(4).build();
    let glass           = Block::new("Glass").id(5).is_transparent(true).is_see_through(true).build();
    let wood            = Block::new("Wood").id(6).build();
    let dark_stone      = Block::new("Dark Stone").id(7).build();
    let cobble          = Block::new("Cobblestone").id(8).build();
    let water           = Block::new("Water").id(9).is_fluid(true).is_passable(true).is_transparent(true).is_see_through(true).build();
    let _sand           = Block::new("Sand").id(10).build();
    let plank           = Block::new("Plank").id(11).build();
    let orange_concrete = Block::new("Orange Concrete").id(12).build();
    let white_concrete  = Block::new("White Concrete").id(13).build();
    let steel           = Block::new("Steel").id(14).build();
    let tent_canvas     = Block::new("Tent Canvas").id(15).build();
    let cardboard       = Block::new("Cardboard").id(16).build();
    let lamp            = Block::new("Lamp").id(17).is_transparent(true).is_see_through(true).torch_light_level(12).build();
    let leaf            = Block::new("Leaf").id(18).is_transparent(true).build();

    // Extract IDs before moving blocks into registry
    let (stone_id, dirt_id, grass_id) = (stone.id, dirt.id, grass.id);

    let mut registry = Registry::new();
    registry.register_blocks(&[
        dirt, stone, grass, brick, glass, wood, dark_stone, cobble,
        water, _sand, plank, orange_concrete, white_concrete, steel,
        tent_canvas, cardboard, lamp, leaf,
    ]);

    // ── World config ──────────────────────────────────────────────────────────
    let config = WorldConfig::new()
        .min_chunk([-4, -4])
        .max_chunk([ 4,  4])
        .preload(true)
        .preload_radius(4)
        .time_per_day(24000)
        .default_time(19992.0)
        .build();

    let mut world = World::new("tutorial", &config);
    {
        let mut pipeline = world.pipeline_mut();
        pipeline.add_stage(
            FlatlandStage::new()
                .add_soiling(stone_id, 10)
                .add_soiling(dirt_id,  2)
                .add_soiling(grass_id, 1),
        );
        pipeline.add_stage(CityStage);
    }

    // ── Health system ─────────────────────────────────────────────────────────
    let player_hp: Arc<Mutex<HashMap<String, i32>>> = Arc::new(Mutex::new(HashMap::new()));
    health::register_handlers(&mut world, Arc::clone(&player_hp));

    // ── NPC state ─────────────────────────────────────────────────────────────
    let make_npc = |def: &NpcDef| Arc::new(Mutex::new(NpcState {
        pos: def.spawn,
        direction: (0.0, 0.0, 1.0),
        emotion: "neutral".to_string(),
        current_action: fallback_action(),
        memory: HashMap::new(),
        message_queue: Vec::new(),
        tick_in_flight: false,
        nearby_items: Vec::new(),
        held_item: None,
        last_autonomous_tick: std::time::Instant::now(),
    }));

    let thomas_state = make_npc(&THOMAS);
    let marcus_state = make_npc(&MARCUS);
    let diane_state  = make_npc(&DIANE);
    let chad_state   = make_npc(&CHAD);

    // ── AWS / NPC brain ───────────────────────────────────────────────────────
    let npc_enabled = std::env::var("AWS_ACCESS_KEY_ID").is_ok()
        && std::env::var("AWS_SECRET_ACCESS_KEY").is_ok();

    if !npc_enabled {
        eprintln!("INFO: AWS creds not set — NPC brain disabled");
    }

    let creds = Arc::new(AwsCreds {
        access_key: std::env::var("AWS_ACCESS_KEY_ID").unwrap_or_default(),
        secret_key: std::env::var("AWS_SECRET_ACCESS_KEY").unwrap_or_default(),
        region: std::env::var("AWS_REGION").unwrap_or_else(|_| "us-east-1".to_string()),
    });

    let players: SharedPlayers = Arc::new(Mutex::new(Vec::new()));
    let (broadcast_tx, _) = tokio::sync::broadcast::channel::<String>(128);

    let http_client = reqwest::Client::builder()
        .use_rustls_tls()
        .timeout(Duration::from_secs(10))
        .build()
        .expect("HTTP client");

    if npc_enabled {
        for (def, state) in [
            (&THOMAS, Arc::clone(&thomas_state)),
            (&MARCUS, Arc::clone(&marcus_state)),
            (&DIANE,  Arc::clone(&diane_state)),
            (&CHAD,   Arc::clone(&chad_state)),
        ] {
            tokio::spawn(run_npc_tick(
                def, state,
                Arc::clone(&players),
                Arc::clone(&creds),
                http_client.clone(),
                broadcast_tx.clone(),
            ));
        }
    }

    let npc_map: NpcMap = Arc::new(Mutex::new({
        let mut m = HashMap::new();
        m.insert("thomas".to_string(), Arc::clone(&thomas_state));
        m.insert("marcus".to_string(), Arc::clone(&marcus_state));
        m.insert("diane".to_string(),  Arc::clone(&diane_state));
        m.insert("chad".to_string(),   Arc::clone(&chad_state));
        m
    }));

    // ── HTTP API (port 4001) ──────────────────────────────────────────────────
    let players_clone     = Arc::clone(&players);
    let npc_map_clone     = Arc::clone(&npc_map);
    let broadcast_clone   = broadcast_tx.clone();
    let openai_key        = Arc::new(std::env::var("OPENAI_API_KEY").unwrap_or_default());
    let el_key            = Arc::new(std::env::var("ELEVENLABS_API_KEY").unwrap_or_default());

    let http_server = HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(Arc::clone(&npc_map_clone)))
            .app_data(web::Data::new(Arc::clone(&players_clone)))
            .app_data(web::Data::new(broadcast_clone.clone()))
            .app_data(web::Data::new((*openai_key).clone()))
            .app_data(web::Data::new((*el_key).clone()))
            .wrap(actix_web::middleware::DefaultHeaders::new()
                .add(("Access-Control-Allow-Origin", "*"))
                .add(("Access-Control-Allow-Methods", "GET, POST, OPTIONS"))
                .add(("Access-Control-Allow-Headers", "Content-Type")))
            .route("/npc-context",   web::post().to(handle_npc_context))
            .route("/npc-context",   web::method(actix_web::http::Method::OPTIONS).to(handle_options))
            .route("/npc-message",   web::post().to(handle_npc_message))
            .route("/npc-message",   web::method(actix_web::http::Method::OPTIONS).to(handle_options))
            .route("/npc-state",     web::get().to(handle_npc_state))
            .route("/npc-events",    web::get().to(handle_npc_events))
            .route("/npc-voice",     web::get().to(handle_npc_voice))
            .route("/player-update", web::post().to(handle_player_update))
            .route("/player-update", web::method(actix_web::http::Method::OPTIONS).to(handle_options))
            .route("/player-leave",  web::post().to(handle_player_leave))
            .route("/player-leave",  web::method(actix_web::http::Method::OPTIONS).to(handle_options))
    })
    .bind("0.0.0.0:4001")?
    .run();

    // ── Voxelize server (port 4000) ───────────────────────────────────────────
    let mut vox_server = Server::new().port(4000).registry(&registry).build();
    vox_server.add_world(world).expect("Failed to add world");

    tokio::select! {
        r = Voxelize::run(vox_server) => r,
        r = http_server => r,
    }
}
