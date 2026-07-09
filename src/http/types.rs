use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use crate::npc::types::NpcState;

pub type NpcMap = Arc<Mutex<HashMap<String, Arc<Mutex<NpcState>>>>>;
pub type SharedPlayers = Arc<Mutex<Vec<PlayerInfo>>>;

#[derive(Clone, serde::Deserialize, serde::Serialize)]
pub struct PlayerInfo {
    pub id: String,
    pub name: String,
    pub pos: [f32; 3],
}

#[derive(serde::Deserialize)]
pub struct NpcMessageBody {
    pub npc_id: String,
    pub player_id: String,
    pub player_name: String,
    pub message: String,
}

#[derive(serde::Deserialize)]
pub struct NpcStateQuery {
    pub npc_id: String,
}

#[derive(serde::Deserialize)]
pub struct PlayerUpdateBody {
    pub id: String,
    pub name: String,
    pub pos: [f32; 3],
}

#[derive(serde::Deserialize)]
pub struct PlayerLeaveBody {
    pub id: String,
}

#[derive(serde::Deserialize)]
pub struct NearbyItemEntry {
    pub id: String,
    pub dist: f32,
}

#[derive(serde::Deserialize)]
pub struct NpcContextBody {
    pub npc_id: String,
    pub nearby_items: Vec<NearbyItemEntry>,
    pub held_item: Option<String>,
    #[serde(default)]
    pub player_trust: Option<i32>,
}
