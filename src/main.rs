use voxelize::{
    Block, Chunk, ChunkStage, FlatlandStage, Registry, Resources, Server, Space, Vec3,
    VoxelAccess, Voxelize, World, WorldConfig,
};

// ─── Building stage ───────────────────────────────────────────────────────────
// Generates a castle tower at voxel origin only in chunk [0, 0].

struct BuildingStage;

impl BuildingStage {
    fn set_rect(
        chunk: &mut Chunk,
        x0: i32,
        z0: i32,
        x1: i32,
        z1: i32,
        y: i32,
        id: u32,
    ) {
        for vx in x0..=x1 {
            for vz in z0..=z1 {
                chunk.set_voxel(vx, y, vz, id);
            }
        }
    }

    fn set_walls(
        chunk: &mut Chunk,
        x0: i32,
        z0: i32,
        x1: i32,
        z1: i32,
        y: i32,
        id: u32,
    ) {
        for vx in x0..=x1 {
            chunk.set_voxel(vx, y, z0, id);
            chunk.set_voxel(vx, y, z1, id);
        }
        for vz in z0..=z1 {
            chunk.set_voxel(x0, y, vz, id);
            chunk.set_voxel(x1, y, vz, id);
        }
    }

    fn set_col(chunk: &mut Chunk, vx: i32, vz: i32, y0: i32, y1: i32, id: u32) {
        for vy in y0..=y1 {
            chunk.set_voxel(vx, vy, vz, id);
        }
    }
}

impl ChunkStage for BuildingStage {
    fn name(&self) -> String {
        "Building".to_owned()
    }

    fn process(&self, mut chunk: Chunk, resources: Resources, _: Option<Space>) -> Chunk {
        // Only build in the origin chunk
        if chunk.coords != (0, 0) {
            return chunk;
        }

        let reg = &resources.registry;
        let brick = reg.get_block_by_name("Brick").id;
        let dark = reg.get_block_by_name("Dark Stone").id;
        let glass = reg.get_block_by_name("Glass").id;
        let wood = reg.get_block_by_name("Wood").id;
        let cobble = reg.get_block_by_name("Cobblestone").id;
        let stone = reg.get_block_by_name("Stone").id;

        // Ground level is 13 (stone x10 + dirt x2 + grass x1)
        let ground = 13;

        // ── Outer wall footprint: 16×16 centered at (0,0)
        let wx0 = -8_i32;
        let wz0 = -8_i32;
        let wx1 = 7_i32;
        let wz1 = 7_i32;
        let wall_top = ground + 8;

        // Outer walls (cobblestone), 8 blocks tall
        for vy in ground..=wall_top {
            Self::set_walls(&mut chunk, wx0, wz0, wx1, wz1, vy, cobble);
        }

        // Floor inside the walls
        Self::set_rect(&mut chunk, wx0 + 1, wz0 + 1, wx1 - 1, wz1 - 1, ground, stone);

        // Battlements on top of outer wall (every other block)
        for vx in wx0..=wx1 {
            if (vx - wx0) % 2 == 0 {
                chunk.set_voxel(vx, wall_top + 1, wz0, cobble);
                chunk.set_voxel(vx, wall_top + 1, wz1, cobble);
            }
        }
        for vz in wz0..=wz1 {
            if (vz - wz0) % 2 == 0 {
                chunk.set_voxel(wx0, wall_top + 1, vz, cobble);
                chunk.set_voxel(wx1, wall_top + 1, vz, cobble);
            }
        }

        // ── Corner towers: 4×4, 14 blocks tall
        let tower_tops = [
            (wx0, wz0),
            (wx0, wz1 - 3),
            (wx1 - 3, wz0),
            (wx1 - 3, wz1 - 3),
        ];
        let tower_top = ground + 14;
        for (tx, tz) in tower_tops {
            for vy in ground..=tower_top {
                Self::set_walls(&mut chunk, tx, tz, tx + 3, tz + 3, vy, brick);
            }
            // Tower roof cap
            Self::set_rect(&mut chunk, tx, tz, tx + 3, tz + 3, tower_top + 1, dark);
            // Battlements on towers
            for i in 0..=3 {
                if i % 2 == 0 {
                    chunk.set_voxel(tx + i, tower_top + 2, tz, brick);
                    chunk.set_voxel(tx + i, tower_top + 2, tz + 3, brick);
                    chunk.set_voxel(tx, tower_top + 2, tz + i, brick);
                    chunk.set_voxel(tx + 3, tower_top + 2, tz + i, brick);
                }
            }
        }

        // ── Central keep: 8×8, 18 blocks tall
        let kx0 = -4_i32;
        let kz0 = -4_i32;
        let kx1 = 3_i32;
        let kz1 = 3_i32;
        let keep_top = ground + 18;

        for vy in ground..=keep_top {
            Self::set_walls(&mut chunk, kx0, kz0, kx1, kz1, vy, brick);
        }
        // Keep floor
        Self::set_rect(&mut chunk, kx0 + 1, kz0 + 1, kx1 - 1, kz1 - 1, ground + 1, wood);

        // Windows on keep (glass, every 4 blocks up, 2 wide)
        for vy in [ground + 4, ground + 9, ground + 14] {
            // North/south faces
            for vx in [kx0 + 2, kx0 + 4] {
                chunk.set_voxel(vx, vy, kz0, glass);
                chunk.set_voxel(vx, vy, kz1, glass);
            }
            // East/west faces
            for vz in [kz0 + 2, kz0 + 4] {
                chunk.set_voxel(kx0, vy, vz, glass);
                chunk.set_voxel(kx1, vy, vz, glass);
            }
        }

        // Keep roof (dark stone)
        Self::set_rect(&mut chunk, kx0, kz0, kx1, kz1, keep_top + 1, dark);

        // Spire on top of keep (4 blocks of dark stone tapering)
        let spire_levels = [((-1, -1), (0, 0)), ((-1, -1), (0, 0))];
        Self::set_col(&mut chunk, -1, -1, keep_top + 2, keep_top + 5, dark);
        Self::set_col(&mut chunk, -1, 0, keep_top + 2, keep_top + 5, dark);
        Self::set_col(&mut chunk, 0, -1, keep_top + 2, keep_top + 5, dark);
        Self::set_col(&mut chunk, 0, 0, keep_top + 2, keep_top + 5, dark);
        // Spire tip
        chunk.set_voxel(0, keep_top + 6, 0, brick);
        chunk.set_voxel(-1, keep_top + 6, 0, brick);
        chunk.set_voxel(0, keep_top + 6, -1, brick);
        chunk.set_voxel(-1, keep_top + 6, -1, brick);
        chunk.set_voxel(0, keep_top + 7, 0, dark);

        // ── Gateway (opening in south wall)
        for vy in ground..=ground + 3 {
            chunk.set_voxel(-1, vy, wz0, 0);
            chunk.set_voxel(0, vy, wz0, 0);
        }

        let _ = spire_levels;
        chunk
    }
}

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
        pipeline.add_stage(BuildingStage);
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
