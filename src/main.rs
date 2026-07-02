use voxelize::{
    Block, Chunk, ChunkStage, FlatlandStage, Registry, Resources, Server, Space,
    VoxelAccess, Voxelize, World, WorldConfig,
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
        for vz in z0..=z1 {
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

// ── city stage ────────────────────────────────────────────────────────────────

struct CityStage;

impl CityStage {
    // Flat-roofed office block
    fn office(chunk: &mut Chunk, ox: i32, oz: i32, ground: i32, ids: &Ids) {
        let h = 10;
        walls(chunk, ox, ground, oz, ox + 7, ground + h, oz + 7, ids.dark_stone);
        // glass window strips every 2 floors
        for floor in 0..5 {
            let vy = ground + 2 + floor * 2;
            for vx in ox + 1..=ox + 6 {
                chunk.set_voxel(vx, vy, oz, ids.glass);
                chunk.set_voxel(vx, vy, oz + 7, ids.glass);
            }
            for vz in oz + 1..=oz + 6 {
                chunk.set_voxel(ox, vy, vz, ids.glass);
                chunk.set_voxel(ox + 7, vy, vz, ids.glass);
            }
        }
        // rooftop lip
        fill(chunk, ox, ground + h + 1, oz, ox + 7, ground + h + 1, oz + 7, ids.cobble);
    }

    // Tall skyscraper
    fn skyscraper(chunk: &mut Chunk, ox: i32, oz: i32, ground: i32, ids: &Ids) {
        let h = 22;
        // glass facade
        walls(chunk, ox, ground, oz, ox + 5, ground + h, oz + 5, ids.glass);
        // dark stone corner pillars
        for (px, pz) in [(ox, oz), (ox + 5, oz), (ox, oz + 5), (ox + 5, oz + 5)] {
            col(chunk, px, pz, ground, ground + h, ids.dark_stone);
        }
        // setback spire
        col(chunk, ox + 2, oz + 2, ground + h + 1, ground + h + 6, ids.dark_stone);
        col(chunk, ox + 3, oz + 2, ground + h + 1, ground + h + 6, ids.dark_stone);
        col(chunk, ox + 2, oz + 3, ground + h + 1, ground + h + 6, ids.dark_stone);
        col(chunk, ox + 3, oz + 3, ground + h + 1, ground + h + 6, ids.dark_stone);
        chunk.set_voxel(ox + 2, ground + h + 7, oz + 2, ids.brick);
        chunk.set_voxel(ox + 3, ground + h + 7, oz + 2, ids.brick);
        chunk.set_voxel(ox + 2, ground + h + 7, oz + 3, ids.brick);
        chunk.set_voxel(ox + 3, ground + h + 7, oz + 3, ids.brick);
        chunk.set_voxel(ox + 2, ground + h + 8, oz + 2, ids.dark_stone);
    }

    // Low brick shop
    fn shop(chunk: &mut Chunk, ox: i32, oz: i32, ground: i32, ids: &Ids) {
        let h = 5;
        walls(chunk, ox, ground, oz, ox + 5, ground + h, oz + 4, ids.brick);
        // door gap
        chunk.set_voxel(ox + 2, ground, oz, 0);
        chunk.set_voxel(ox + 3, ground, oz, 0);
        chunk.set_voxel(ox + 2, ground + 1, oz, 0);
        chunk.set_voxel(ox + 3, ground + 1, oz, 0);
        // windows
        chunk.set_voxel(ox + 1, ground + 2, oz, ids.glass);
        chunk.set_voxel(ox + 4, ground + 2, oz, ids.glass);
        // flat wood roof
        fill(chunk, ox, ground + h + 1, oz, ox + 5, ground + h + 1, oz + 4, ids.wood);
    }

    // Road (stone strip)
    fn road(chunk: &mut Chunk, x0: i32, z0: i32, x1: i32, z1: i32, ground: i32, ids: &Ids) {
        for vx in x0..=x1 {
            for vz in z0..=z1 {
                chunk.set_voxel(vx, ground, vz, ids.stone);
                // overwrite the grass layer
                chunk.set_voxel(vx, ground - 1, vz, ids.stone);
            }
        }
    }

    // Castle (original feature)
    fn castle(chunk: &mut Chunk, ground: i32, ids: &Ids) {
        let (wx0, wz0, wx1, wz1) = (-8, -8, 7, 7);
        let wall_top = ground + 8;
        for vy in ground..=wall_top {
            for vx in wx0..=wx1 {
                chunk.set_voxel(vx, vy, wz0, ids.cobble);
                chunk.set_voxel(vx, vy, wz1, ids.cobble);
            }
            for vz in wz0..=wz1 {
                chunk.set_voxel(wx0, vy, vz, ids.cobble);
                chunk.set_voxel(wx1, vy, vz, ids.cobble);
            }
        }
        fill(chunk, wx0 + 1, ground, wz0 + 1, wx1 - 1, ground, wz1 - 1, ids.stone);
        // battlements
        for vx in wx0..=wx1 {
            if (vx - wx0) % 2 == 0 {
                chunk.set_voxel(vx, wall_top + 1, wz0, ids.cobble);
                chunk.set_voxel(vx, wall_top + 1, wz1, ids.cobble);
            }
        }
        for vz in wz0..=wz1 {
            if (vz - wz0) % 2 == 0 {
                chunk.set_voxel(wx0, wall_top + 1, vz, ids.cobble);
                chunk.set_voxel(wx1, wall_top + 1, vz, ids.cobble);
            }
        }
        // corner towers
        for (tx, tz) in [(wx0, wz0), (wx0, wz1 - 3), (wx1 - 3, wz0), (wx1 - 3, wz1 - 3)] {
            let tt = ground + 14;
            walls(chunk, tx, ground, tz, tx + 3, tt, tz + 3, ids.brick);
            fill(chunk, tx, tt + 1, tz, tx + 3, tt + 1, tz + 3, ids.dark_stone);
            for i in 0..=3_i32 {
                if i % 2 == 0 {
                    chunk.set_voxel(tx + i, tt + 2, tz, ids.brick);
                    chunk.set_voxel(tx + i, tt + 2, tz + 3, ids.brick);
                    chunk.set_voxel(tx, tt + 2, tz + i, ids.brick);
                    chunk.set_voxel(tx + 3, tt + 2, tz + i, ids.brick);
                }
            }
        }
        // keep
        let (kx0, kz0, kx1, kz1) = (-4, -4, 3, 3);
        let kt = ground + 18;
        walls(chunk, kx0, ground, kz0, kx1, kt, kz1, ids.brick);
        fill(chunk, kx0 + 1, ground + 1, kz0 + 1, kx1 - 1, ground + 1, kz1 - 1, ids.wood);
        for vy in [ground + 4, ground + 9, ground + 14] {
            for vx in [kx0 + 2, kx0 + 4] {
                chunk.set_voxel(vx, vy, kz0, ids.glass);
                chunk.set_voxel(vx, vy, kz1, ids.glass);
            }
            for vz in [kz0 + 2, kz0 + 4] {
                chunk.set_voxel(kx0, vy, vz, ids.glass);
                chunk.set_voxel(kx1, vy, vz, ids.glass);
            }
        }
        fill(chunk, kx0, kt + 1, kz0, kx1, kt + 1, kz1, ids.dark_stone);
        for dx in [-1, 0] {
            for dz in [-1, 0] {
                col(chunk, dx, dz, kt + 2, kt + 5, ids.dark_stone);
            }
        }
        chunk.set_voxel(0, kt + 7, 0, ids.dark_stone);
        // gateway
        for vy in ground..=ground + 3 {
            chunk.set_voxel(-1, vy, wz0, 0);
            chunk.set_voxel(0, vy, wz0, 0);
        }
    }
}

struct Ids {
    stone: u32,
    brick: u32,
    glass: u32,
    wood: u32,
    dark_stone: u32,
    cobble: u32,
}

impl ChunkStage for CityStage {
    fn name(&self) -> String {
        "City".to_owned()
    }

    fn process(&self, mut chunk: Chunk, resources: Resources, _: Option<Space>) -> Chunk {
        let reg = &resources.registry;
        let ids = Ids {
            stone: reg.get_block_by_name("Stone").id,
            brick: reg.get_block_by_name("Brick").id,
            glass: reg.get_block_by_name("Glass").id,
            wood: reg.get_block_by_name("Wood").id,
            dark_stone: reg.get_block_by_name("Dark Stone").id,
            cobble: reg.get_block_by_name("Cobblestone").id,
        };

        let ground = 13;
        let cx = chunk.coords.0;
        let cz = chunk.coords.1;

        match (cx, cz) {
            // Origin chunk: castle
            (0, 0) => Self::castle(&mut chunk, ground, &ids),

            // East block: skyscraper + office
            (1, 0) => {
                Self::skyscraper(&mut chunk, 2, 2, ground, &ids);
                Self::office(&mut chunk, 2, 10, ground, &ids);
            }

            // North block: two offices + shops
            (0, 1) => {
                Self::office(&mut chunk, 1, 1, ground, &ids);
                Self::office(&mut chunk, 10, 1, ground, &ids);
                Self::shop(&mut chunk, 2, 10, ground, &ids);
                Self::shop(&mut chunk, 9, 10, ground, &ids);
            }

            // NE block: skyscraper cluster
            (1, 1) => {
                Self::skyscraper(&mut chunk, 1, 1, ground, &ids);
                Self::office(&mut chunk, 8, 1, ground, &ids);
                Self::shop(&mut chunk, 1, 9, ground, &ids);
                Self::shop(&mut chunk, 8, 9, ground, &ids);
            }

            // South block: shops row
            (0, -1) => {
                for i in 0..2 {
                    Self::shop(&mut chunk, 1 + i * 7, 2, ground, &ids);
                    Self::shop(&mut chunk, 1 + i * 7, 9, ground, &ids);
                }
            }

            // West block: office row
            (-1, 0) => {
                Self::office(&mut chunk, 2, 2, ground, &ids);
                Self::office(&mut chunk, 2, 12, ground, &ids);
            }

            _ => {}
        }

        // Roads: lay stone strips along chunk edges in every city chunk
        let city_chunks: &[(i32, i32)] = &[
            (0, 0), (1, 0), (0, 1), (1, 1), (0, -1), (-1, 0),
        ];
        if city_chunks.contains(&(cx, cz)) {
            let size = 16_i32;
            let base_x = cx * size;
            let base_z = cz * size;
            // E–W road along z=0 of this chunk
            Self::road(
                &mut chunk,
                base_x, base_z,
                base_x + size - 1, base_z,
                ground, &ids,
            );
            // N–S road along x=0
            Self::road(
                &mut chunk,
                base_x, base_z,
                base_x, base_z + size - 1,
                ground, &ids,
            );
        }

        chunk
    }
}

// ── main ──────────────────────────────────────────────────────────────────────

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let dirt = Block::new("Dirt").id(1).build();
    let stone = Block::new("Stone").id(2).build();
    let grass_block = Block::new("Grass Block").id(3).build();
    let brick = Block::new("Brick").id(4).build();
    let glass = Block::new("Glass").id(5).is_transparent(true).build();
    let wood = Block::new("Wood").id(6).build();
    let dark_stone = Block::new("Dark Stone").id(7).build();
    let cobblestone = Block::new("Cobblestone").id(8).build();

    let config = WorldConfig::new()
        .min_chunk([-10, -10])
        .max_chunk([10, 10])
        .time_per_day(24000)
        .default_time(6000.0) // midday
        .build();

    let mut world = World::new("tutorial", &config);

    {
        let mut pipeline = world.pipeline_mut();
        pipeline.add_stage(
            FlatlandStage::new()
                .add_soiling(stone.id, 10)
                .add_soiling(dirt.id, 2)
                .add_soiling(grass_block.id, 1),
        );
        pipeline.add_stage(CityStage);
    }

    let mut registry = Registry::new();
    registry.register_blocks(&[
        dirt, stone, grass_block, brick, glass, wood, dark_stone, cobblestone,
    ]);

    let mut server = Server::new().port(4000).registry(&registry).build();

    server
        .add_world(world)
        .expect("Failed to add world to server");

    Voxelize::run(server).await
}
