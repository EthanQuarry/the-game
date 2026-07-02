use voxelize::{
    Block, Chunk, ChunkStage, FlatlandStage, Registry, Resources, Server, Space,
    VoxelAccess, Voxelize, World, WorldConfig, Vec3,
};

// ── helpers ───────────────────────────────────────────────────────────────────

fn fill(chunk: &mut Chunk, x0: i32, y0: i32, z0: i32, x1: i32, y1: i32, z1: i32, id: u32) {
    for vx in x0..=x1 {
        for vy in y0..=y1 {
            for vz in z0..=z1 {
                chunk.set_voxel(vx, vy, vz, id);
            }
        }
    }
}

fn walls(chunk: &mut Chunk, x0: i32, y0: i32, z0: i32, x1: i32, y1: i32, z1: i32, id: u32) {
    for vy in y0..=y1 {
        for vx in x0..=x1 {
            chunk.set_voxel(vx, vy, z0, id);
            chunk.set_voxel(vx, vy, z1, id);
        }
        for vz in z0 + 1..z1 {
            chunk.set_voxel(x0, vy, vz, id);
            chunk.set_voxel(x1, vy, vz, id);
        }
    }
}

fn col(chunk: &mut Chunk, vx: i32, vz: i32, y0: i32, y1: i32, id: u32) {
    for vy in y0..=y1 {
        chunk.set_voxel(vx, vy, vz, id);
    }
}

struct Ids {
    stone: u32,
    brick: u32,
    glass: u32,
    dark_stone: u32,
    cobble: u32,
}

// ── city stage ────────────────────────────────────────────────────────────────
//
// Chunk layout (each = 16×16 voxels, default chunk_size):
//
//   chunk [cx, cz] → world origin bx = cx*16, bz = cz*16
//   ground = 13  (stone×10 + dirt×2 + grass×1, surface at y=12, build from y=13)
//
//   Road: a 4-wide stone strip runs along world X axis at Z = 8..11
//         and along world Z axis at X = 8..11
//         These run through chunk [0,0] only — simple and clean.
//
//   Buildings placed in chunks away from [0,0]:
//     [1,0]  = office block (east of road)
//     [-1,0] = office block (west of road)
//     [0,1]  = skyscraper (north of road)
//     [0,-1] = shops (south of road)
//
//   Each building is offset 2 blocks from the chunk edge so there's a gap.

struct CityStage;

impl ChunkStage for CityStage {
    fn name(&self) -> String {
        "City".to_owned()
    }

    fn process(&self, mut chunk: Chunk, resources: Resources, _: Option<Space>) -> Chunk {
        let reg = &resources.registry;
        let ids = Ids {
            stone:      reg.get_block_by_name("Stone").id,
            brick:      reg.get_block_by_name("Brick").id,
            glass:      reg.get_block_by_name("Glass").id,
            dark_stone: reg.get_block_by_name("Dark Stone").id,
            cobble:     reg.get_block_by_name("Cobblestone").id,
        };

        // terrain: stone×10, dirt×2, grass×1 → surface at y=12, build from y=13
        let g = 13;
        let Vec3(bx, _, bz) = chunk.min;
        let cx = chunk.coords.0;
        let cz = chunk.coords.1;

        match (cx, cz) {
            // ── [0,0]: road intersection only ────────────────────────────────
            (0, 0) => {
                // E-W road: 4 wide along Z axis, full chunk X span
                fill(&mut chunk, bx, g - 1, bz + 6, bx + 15, g, bz + 9, ids.stone);
                // N-S road: 4 wide along X axis, full chunk Z span
                fill(&mut chunk, bx + 6, g - 1, bz, bx + 9, g, bz + 15, ids.stone);
            }

            // ── [1,0]: office block east, road on west edge ──────────────────
            // Road is in [0,0] so no road in this chunk.
            // E-W road continues: fill Z=6..9 on low-X end of this chunk too.
            (1, 0) => {
                fill(&mut chunk, bx, g - 1, bz + 6, bx + 15, g, bz + 9, ids.stone);
                // Office: 10 wide, 8 deep, 8 tall. Placed at bx+3, bz+2
                // (away from road strip at bz+6..9 on south side)
                let ox = bx + 3;
                let oz = bz + 2; // north side of chunk, away from road
                walls(&mut chunk, ox, g, oz, ox + 9, g + 7, oz + 5, ids.dark_stone);
                // glass windows every 2 floors
                for vy in [g + 2, g + 5] {
                    for vx in ox + 1..ox + 9 {
                        chunk.set_voxel(vx, vy, oz, ids.glass);
                        chunk.set_voxel(vx, vy, oz + 5, ids.glass);
                    }
                    for vz in oz + 1..oz + 5 {
                        chunk.set_voxel(ox, vy, vz, ids.glass);
                        chunk.set_voxel(ox + 9, vy, vz, ids.glass);
                    }
                }
                fill(&mut chunk, ox, g + 8, oz, ox + 9, g + 8, oz + 5, ids.cobble);
            }

            // ── [-1,0]: office block west ─────────────────────────────────────
            (-1, 0) => {
                fill(&mut chunk, bx, g - 1, bz + 6, bx + 15, g, bz + 9, ids.stone);
                let ox = bx + 3;
                let oz = bz + 2;
                walls(&mut chunk, ox, g, oz, ox + 9, g + 7, oz + 5, ids.brick);
                for vy in [g + 2, g + 5] {
                    for vx in ox + 1..ox + 9 {
                        chunk.set_voxel(vx, vy, oz, ids.glass);
                        chunk.set_voxel(vx, vy, oz + 5, ids.glass);
                    }
                    for vz in oz + 1..oz + 5 {
                        chunk.set_voxel(ox, vy, vz, ids.glass);
                        chunk.set_voxel(ox + 9, vy, vz, ids.glass);
                    }
                }
                fill(&mut chunk, ox, g + 8, oz, ox + 9, g + 8, oz + 5, ids.cobble);
            }

            // ── [0,1]: skyscraper north ───────────────────────────────────────
            (0, 1) => {
                fill(&mut chunk, bx + 6, g - 1, bz, bx + 9, g, bz + 15, ids.stone);
                // Skyscraper: 8×8, 16 tall. Centred in chunk at bx+4, bz+4
                let ox = bx + 4;
                let oz = bz + 4;
                walls(&mut chunk, ox, g, oz, ox + 7, g + 15, oz + 7, ids.glass);
                // dark stone corner columns
                for (px, pz) in [(ox, oz), (ox + 7, oz), (ox, oz + 7), (ox + 7, oz + 7)] {
                    col(&mut chunk, px, pz, g, g + 15, ids.dark_stone);
                }
                // floor bands every 4
                for vy in [g + 4, g + 8, g + 12] {
                    for vx in ox..=ox + 7 {
                        chunk.set_voxel(vx, vy, oz, ids.dark_stone);
                        chunk.set_voxel(vx, vy, oz + 7, ids.dark_stone);
                    }
                    for vz in oz..=oz + 7 {
                        chunk.set_voxel(ox, vy, vz, ids.dark_stone);
                        chunk.set_voxel(ox + 7, vy, vz, ids.dark_stone);
                    }
                }
                // roof + spire
                fill(&mut chunk, ox, g + 16, oz, ox + 7, g + 16, oz + 7, ids.dark_stone);
                col(&mut chunk, ox + 3, oz + 3, g + 17, g + 22, ids.dark_stone);
                chunk.set_voxel(ox + 3, g + 23, oz + 3, ids.brick);
            }

            // ── [0,-1]: small shops south ─────────────────────────────────────
            (0, -1) => {
                fill(&mut chunk, bx + 6, g - 1, bz, bx + 9, g, bz + 15, ids.stone);
                // Two shops side by side
                for (ox, oz) in [(bx + 1, bz + 2), (bx + 9, bz + 2)] {
                    walls(&mut chunk, ox, g, oz, ox + 5, g + 4, oz + 5, ids.brick);
                    chunk.set_voxel(ox + 2, g, oz, 0);
                    chunk.set_voxel(ox + 2, g + 1, oz, 0);
                    chunk.set_voxel(ox + 1, g + 2, oz, ids.glass);
                    chunk.set_voxel(ox + 3, g + 2, oz, ids.glass);
                    fill(&mut chunk, ox, g + 5, oz, ox + 5, g + 5, oz + 5, ids.cobble);
                }
            }

            // ── [1,1]: streetlights in the corner ────────────────────────────
            (1, 1) | (-1, 1) | (1, -1) | (-1, -1) => {
                // Streetlight pole at corner near road
                let lx = if cx > 0 { bx + 1 } else { bx + 14 };
                let lz = if cz > 0 { bz + 1 } else { bz + 14 };
                col(&mut chunk, lx, lz, g, g + 5, ids.dark_stone);
                chunk.set_voxel(lx + 1, g + 5, lz, ids.dark_stone);
                chunk.set_voxel(lx + 2, g + 5, lz, ids.cobble);
            }

            _ => {}
        }

        chunk
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let dirt       = Block::new("Dirt").id(1).build();
    let stone      = Block::new("Stone").id(2).build();
    let grass      = Block::new("Grass Block").id(3).build();
    let brick      = Block::new("Brick").id(4).build();
    let glass      = Block::new("Glass").id(5).is_transparent(true).build();
    let wood       = Block::new("Wood").id(6).build();
    let dark_stone = Block::new("Dark Stone").id(7).build();
    let cobble     = Block::new("Cobblestone").id(8).build();

    let config = WorldConfig::new()
        .min_chunk([-128, -128])
        .max_chunk([128, 128])
        .time_per_day(24000)
        .default_time(12000.0)
        .build();

    let mut world = World::new("tutorial", &config);

    {
        let mut pipeline = world.pipeline_mut();
        pipeline.add_stage(
            FlatlandStage::new()
                .add_soiling(stone.id, 10)
                .add_soiling(dirt.id, 2)
                .add_soiling(grass.id, 1),
        );
        pipeline.add_stage(CityStage);
    }

    let mut registry = Registry::new();
    registry.register_blocks(&[dirt, stone, grass, brick, glass, wood, dark_stone, cobble]);

    let mut server = Server::new().port(4000).registry(&registry).build();
    server.add_world(world).expect("Failed to add world");
    Voxelize::run(server).await
}
