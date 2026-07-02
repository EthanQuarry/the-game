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

// ── building types ────────────────────────────────────────────────────────────

struct Ids {
    stone: u32,
    brick: u32,
    glass: u32,
    wood: u32,
    dark_stone: u32,
    cobble: u32,
}

// Simple box building: solid walls, glass windows, flat roof
fn building(
    chunk: &mut Chunk,
    bx: i32, bz: i32,   // world origin corner
    w: i32, d: i32,     // width, depth
    height: i32,
    ground: i32,
    wall_id: u32,
    roof_id: u32,
    ids: &Ids,
) {
    let x1 = bx + w - 1;
    let z1 = bz + d - 1;
    let y1 = ground + height;

    // walls
    walls(chunk, bx, ground, bz, x1, y1, z1, wall_id);

    // windows: two rows of glass on each face
    for vy in [ground + 2, ground + height - 2] {
        if height < 4 { break; }
        // front/back
        for vx in (bx + 1..x1).step_by(2) {
            chunk.set_voxel(vx, vy, bz, ids.glass);
            chunk.set_voxel(vx, vy, z1, ids.glass);
        }
        // sides
        for vz in (bz + 1..z1).step_by(2) {
            chunk.set_voxel(bx, vy, vz, ids.glass);
            chunk.set_voxel(x1, vy, vz, ids.glass);
        }
    }

    // flat roof
    fill(chunk, bx, y1 + 1, bz, x1, y1 + 1, z1, roof_id);
}

// Skyscraper: tall glass tower with dark corner pillars and a spire
fn skyscraper(chunk: &mut Chunk, bx: i32, bz: i32, ground: i32, ids: &Ids) {
    let w = 7;
    let h = 24;
    let x1 = bx + w - 1;
    let z1 = bz + w - 1;
    let y1 = ground + h;

    // glass walls
    walls(chunk, bx, ground, bz, x1, y1, z1, ids.glass);

    // dark corner pillars
    for (px, pz) in [(bx, bz), (x1, bz), (bx, z1), (x1, z1)] {
        col(chunk, px, pz, ground, y1, ids.dark_stone);
    }

    // roof
    fill(chunk, bx, y1 + 1, bz, x1, y1 + 1, z1, ids.dark_stone);

    // spire
    let mx = bx + w / 2;
    let mz = bz + w / 2;
    col(chunk, mx, mz, y1 + 2, y1 + 6, ids.dark_stone);
    chunk.set_voxel(mx, y1 + 7, mz, ids.brick);
}

// ── city stage ────────────────────────────────────────────────────────────────

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
            wood:       reg.get_block_by_name("Wood").id,
            dark_stone: reg.get_block_by_name("Dark Stone").id,
            cobble:     reg.get_block_by_name("Cobblestone").id,
        };

        let ground = 13;
        let Vec3(bx, _, bz) = chunk.min; // world-space origin of this chunk

        match (chunk.coords.0, chunk.coords.1) {

            // ── Chunk [0,0]: castle ──────────────────────────────────────────
            (0, 0) => {
                let cx = bx + 8;
                let cz = bz + 8;
                let r = 7_i32;

                walls(&mut chunk, cx - r, ground, cz - r, cx + r, ground + 7, cz + r, ids.cobble);
                fill(&mut chunk, cx - r + 1, ground, cz - r + 1, cx + r - 1, ground, cz + r - 1, ids.stone);

                for i in -r..=r {
                    if i % 2 == 0 {
                        chunk.set_voxel(cx + i, ground + 8, cz - r, ids.cobble);
                        chunk.set_voxel(cx + i, ground + 8, cz + r, ids.cobble);
                        chunk.set_voxel(cx - r, ground + 8, cz + i, ids.cobble);
                        chunk.set_voxel(cx + r, ground + 8, cz + i, ids.cobble);
                    }
                }

                for (tx, tz) in [(cx-r-1, cz-r-1), (cx+r-2, cz-r-1),
                                  (cx-r-1, cz+r-2), (cx+r-2, cz+r-2)] {
                    walls(&mut chunk, tx, ground, tz, tx + 3, ground + 11, tz + 3, ids.brick);
                    fill(&mut chunk, tx, ground + 12, tz, tx + 3, ground + 12, tz + 3, ids.dark_stone);
                }

                walls(&mut chunk, cx - 3, ground, cz - 3, cx + 3, ground + 14, cz + 3, ids.brick);
                fill(&mut chunk, cx - 2, ground + 1, cz - 2, cx + 2, ground + 1, cz + 2, ids.wood);

                for vy in [ground + 4, ground + 8, ground + 12] {
                    for vx in [cx - 2, cx, cx + 2] {
                        chunk.set_voxel(vx, vy, cz - 3, ids.glass);
                        chunk.set_voxel(vx, vy, cz + 3, ids.glass);
                    }
                    for vz in [cz - 2, cz, cz + 2] {
                        chunk.set_voxel(cx - 3, vy, vz, ids.glass);
                        chunk.set_voxel(cx + 3, vy, vz, ids.glass);
                    }
                }
                fill(&mut chunk, cx - 3, ground + 15, cz - 3, cx + 3, ground + 15, cz + 3, ids.dark_stone);
                col(&mut chunk, cx, cz, ground + 16, ground + 20, ids.dark_stone);
                chunk.set_voxel(cx, ground + 21, cz, ids.brick);

                for vy in ground..=ground + 3 {
                    chunk.set_voxel(cx, vy, cz - r, 0);
                    chunk.set_voxel(cx + 1, vy, cz - r, 0);
                }
            }

            // ── Chunk [1,0]: skyscraper + office ────────────────────────────
            (1, 0) => {
                skyscraper(&mut chunk, bx + 2, bz + 2, ground, &ids);
                building(&mut chunk, bx + 2, bz + 11, 7, 4, 7, ground, ids.cobble, ids.dark_stone, &ids);
            }

            // ── Chunk [0,1]: two offices ─────────────────────────────────────
            (0, 1) => {
                building(&mut chunk, bx + 1, bz + 1, 6, 5, 8, ground, ids.brick, ids.wood, &ids);
                building(&mut chunk, bx + 9, bz + 1, 6, 5, 8, ground, ids.brick, ids.wood, &ids);
                building(&mut chunk, bx + 3, bz + 9, 10, 4, 5, ground, ids.dark_stone, ids.cobble, &ids);
            }

            // ── Chunk [1,1]: skyscraper cluster ──────────────────────────────
            (1, 1) => {
                skyscraper(&mut chunk, bx + 1, bz + 1, ground, &ids);
                building(&mut chunk, bx + 9, bz + 2, 5, 5, 10, ground, ids.dark_stone, ids.cobble, &ids);
                building(&mut chunk, bx + 2, bz + 9, 5, 5, 6, ground, ids.brick, ids.wood, &ids);
            }

            // ── Chunk [-1,0]: offices west ───────────────────────────────────
            (-1, 0) => {
                building(&mut chunk, bx + 2, bz + 2, 7, 5, 9, ground, ids.brick, ids.wood, &ids);
                building(&mut chunk, bx + 2, bz + 9, 7, 5, 6, ground, ids.cobble, ids.dark_stone, &ids);
            }

            // ── Chunk [0,-1]: shops south ────────────────────────────────────
            (0, -1) => {
                building(&mut chunk, bx + 1, bz + 2, 5, 4, 4, ground, ids.brick, ids.wood, &ids);
                building(&mut chunk, bx + 7, bz + 2, 5, 4, 4, ground, ids.brick, ids.wood, &ids);
                building(&mut chunk, bx + 1, bz + 9, 5, 4, 5, ground, ids.cobble, ids.stone, &ids);
                building(&mut chunk, bx + 7, bz + 9, 5, 4, 5, ground, ids.cobble, ids.stone, &ids);
            }

            _ => {}
        }

        chunk
    }
}

// ── main ──────────────────────────────────────────────────────────────────────

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
        .min_chunk([-10, -10])
        .max_chunk([10, 10])
        .time_per_day(24000)
        .default_time(6000.0)
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
