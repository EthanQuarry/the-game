use std::collections::HashMap;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct NpcAction {
    #[serde(rename = "type")]
    pub action_type: String,
    #[serde(default)]
    pub waypoint: Option<String>,
    #[serde(default)]
    pub target_player: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub duration_s: Option<f32>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct LlmResponse {
    pub thought: String,
    pub action: NpcAction,
    pub emotion: String,
    #[serde(default)]
    pub memory_updates: HashMap<String, serde_json::Value>,
}

pub struct NpcState {
    pub pos: (f32, f32, f32),
    pub direction: (f32, f32, f32),
    pub emotion: String,
    pub current_action: NpcAction,
    pub memory: HashMap<String, Vec<String>>,
    pub message_queue: Vec<(String, String, String)>,
    pub tick_in_flight: bool,
    pub nearby_items: Vec<(String, f32)>,
    pub held_item: Option<String>,
    pub last_autonomous_tick: std::time::Instant,
    // Players who have already been greeted — don't greet again until they leave and return
    pub greeted_players: std::collections::HashSet<String>,
}

pub struct NpcDef {
    pub id: &'static str,
    pub name: &'static str,
    pub spawn: (f32, f32, f32),
    pub personality_prompt: &'static str,
    pub waypoints: &'static [(&'static str, (f32, f32, f32))],
    pub nearby_radius: f32,
    pub tick_rate_near_ms: u64,
    pub tick_rate_far_ms: u64,
}

pub fn fallback_action() -> NpcAction {
    NpcAction {
        action_type: "idle".to_string(),
        waypoint: None,
        target_player: None,
        message: Some("...".to_string()),
        duration_s: None,
    }
}

pub fn coerce_memory_updates(
    raw: HashMap<String, serde_json::Value>,
) -> HashMap<String, Option<String>> {
    raw.into_iter().map(|(k, v)| {
        let s = match v {
            serde_json::Value::Null => None,
            serde_json::Value::String(s) => Some(s),
            other => Some(other.to_string()),
        };
        (k, s)
    }).collect()
}
