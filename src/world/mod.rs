use voxelize::{Chunk, ChunkStage, Resources, Space, VoxelAccess, Vec3};

// ── Voxel helpers ─────────────────────────────────────────────────────────────

pub fn fill(c: &mut Chunk, x0: i32, y0: i32, z0: i32, x1: i32, y1: i32, z1: i32, id: u32) {
    for vx in x0..=x1 { for vy in y0..=y1 { for vz in z0..=z1 {
        c.set_voxel(vx, vy, vz, id);
    }}}
}

pub fn walls(c: &mut Chunk, x0: i32, y0: i32, z0: i32, x1: i32, y1: i32, z1: i32, id: u32) {
    for vy in y0..=y1 {
        for vx in x0..=x1 {
            c.set_voxel(vx, vy, z0, id);
            c.set_voxel(vx, vy, z1, id);
        }
        for vz in z0+1..z1 {
            c.set_voxel(x0, vy, vz, id);
            c.set_voxel(x1, vy, vz, id);
        }
    }
}

pub fn col(c: &mut Chunk, vx: i32, vz: i32, y0: i32, y1: i32, id: u32) {
    for vy in y0..=y1 { c.set_voxel(vx, vy, vz, id); }
}

// ── Block ID bundle ───────────────────────────────────────────────────────────

pub struct Ids {
    pub stone:           u32,
    pub brick:           u32,
    pub glass:           u32,
    pub dark_stone:      u32,
    pub cobble:          u32,
    pub wood:            u32,
    pub water:           u32,
    pub plank:           u32,
    pub orange_concrete: u32,
    pub white_concrete:  u32,
    pub steel:           u32,
    pub tent_canvas:     u32,
    pub cardboard:       u32,
    pub lamp:            u32,
    pub leaf:            u32,
}

// ── Prop helpers ──────────────────────────────────────────────────────────────

// Tree: 5-block trunk, layered leaf canopy
pub fn tree(c: &mut Chunk, wx: i32, wz: i32, g: i32, ids: &Ids) {
    for vy in g..=g+4 { c.set_voxel(wx, vy, wz, ids.wood); }
    for (dy, r) in [(5,2),(6,2),(7,1)] {
        for dx in -r..=r { for dz in -r..=r {
            c.set_voxel(wx+dx, g+dy, wz+dz, ids.leaf);
        }}
    }
    c.set_voxel(wx, g+8, wz, ids.leaf);
}

// Street lamp: dark-stone pole + glowing cap
pub fn lamp_post(c: &mut Chunk, wx: i32, wz: i32, g: i32, ids: &Ids) {
    col(c, wx, wz, g, g+5, ids.dark_stone);
    c.set_voxel(wx, g+6, wz, ids.lamp);
}

// Perimeter wall on one edge of a boundary chunk.
// edge: 0=south(z=bz), 1=north(z=bz+15), 2=west(x=bx), 3=east(x=bx+15)
pub fn perim_wall(c: &mut Chunk, bx: i32, bz: i32, g: i32, edge: u8, ids: &Ids) {
    let h = 10;
    match edge {
        0 => { fill(c, bx, g, bz,    bx+15, g+h, bz+1,  ids.brick);
               fill(c, bx, g+h+1, bz, bx+15, g+h+1, bz+1, ids.stone); }
        1 => { fill(c, bx, g, bz+14, bx+15, g+h, bz+15, ids.brick);
               fill(c, bx, g+h+1, bz+14, bx+15, g+h+1, bz+15, ids.stone); }
        2 => { fill(c, bx, g, bz,    bx+1,  g+h, bz+15, ids.brick);
               fill(c, bx, g+h+1, bz, bx+1, g+h+1, bz+15, ids.stone); }
        3 => { fill(c, bx+14, g, bz, bx+15, g+h, bz+15, ids.brick);
               fill(c, bx+14, g+h+1, bz, bx+15, g+h+1, bz+15, ids.stone); }
        _ => {}
    }
}

// Simple building shell: outer walls + hollow interior + flat roof + grid windows
pub fn building(c: &mut Chunk, x0: i32, y0: i32, z0: i32,
                x1: i32, y1: i32, z1: i32,
                facade: u32, roof: u32, ids: &Ids) {
    walls(c, x0, y0, z0, x1, y1, z1, facade);
    fill(c, x0+1, y0+1, z0+1, x1-1, y1-1, z1-1, 0);
    fill(c, x0, y1+1, z0, x1, y1+1, z1, roof);
    // Windows every 3 blocks, 2 tall, on south face
    let mut vy = y0+2;
    while vy < y1 {
        let mut vx = x0+1;
        while vx < x1 {
            c.set_voxel(vx, vy, z0, ids.glass);
            if vy+1 < y1 { c.set_voxel(vx, vy+1, z0, ids.glass); }
            vx += 3;
        }
        vy += 4;
    }
}

// Parked car prop
pub fn parked_car(c: &mut Chunk, x: i32, z: i32, g: i32, ids: &Ids) {
    fill(c, x, g, z, x+3, g+1, z+2, ids.dark_stone);
    c.set_voxel(x+1, g+2, z, ids.glass);
    c.set_voxel(x+2, g+2, z, ids.glass);
}

// Dumpster
pub fn dumpster(c: &mut Chunk, x: i32, z: i32, g: i32, ids: &Ids) {
    fill(c, x, g, z, x+2, g+2, z+1, ids.dark_stone);
}

// ── City stage ────────────────────────────────────────────────────────────────
//
// 7×7 walled city (cx/cz -3..=+3, 112×112 blocks).
// Outer ring = perimeter walls. Interior = city grid.
//
// Road grid (world coords):
//   E-W road: z = -12 .. -5  (8 wide, centred in cz=-1 row)
//   N-S road: x =  -4 .. +3  (8 wide, centred in cx=0 column)
//   Sidewalks: 2-block cobble each side
//
// NPC spawn coords (y = g + eyeHeight ≈ 15.3):
//   Thomas  — (0, 15.3, -20)  tent alley in (0,-2)
//   Marcus  — (-24, 15.3, 8)  projects stairwell in (-2,0)
//   Diane   — (20, 15.3, 8)   bodega in (1,0)
//   Ray     — (-8, 15.3, -8)  pawnshop in (-1,-1)
//
pub struct CityStage;

impl ChunkStage for CityStage {
    fn name(&self) -> String { "City".to_owned() }

    fn process(&self, mut chunk: Chunk, resources: Resources, _: Option<Space>) -> Chunk {
        let reg = &resources.registry;
        let ids = Ids {
            stone:           reg.get_block_by_name("Stone").id,
            brick:           reg.get_block_by_name("Brick").id,
            glass:           reg.get_block_by_name("Glass").id,
            dark_stone:      reg.get_block_by_name("Dark Stone").id,
            cobble:          reg.get_block_by_name("Cobblestone").id,
            wood:            reg.get_block_by_name("Wood").id,
            water:           reg.get_block_by_name("Water").id,
            plank:           reg.get_block_by_name("Plank").id,
            orange_concrete: reg.get_block_by_name("Orange Concrete").id,
            white_concrete:  reg.get_block_by_name("White Concrete").id,
            steel:           reg.get_block_by_name("Steel").id,
            tent_canvas:     reg.get_block_by_name("Tent Canvas").id,
            cardboard:       reg.get_block_by_name("Cardboard").id,
            lamp:            reg.get_block_by_name("Lamp").id,
            leaf:            reg.get_block_by_name("Leaf").id,
        };

        let g = 13_i32; // y of first air layer above grass top
        let Vec3(bx, _, bz) = chunk.min;
        let cx = chunk.coords.0;
        let cz = chunk.coords.1;

        // ── Perimeter walls ──────────────────────────────────────────────
        if cx == -3 { perim_wall(&mut chunk, bx, bz, g, 2, &ids); }
        if cx ==  3 { perim_wall(&mut chunk, bx, bz, g, 3, &ids); }
        if cz == -3 { perim_wall(&mut chunk, bx, bz, g, 0, &ids); }
        if cz ==  3 { perim_wall(&mut chunk, bx, bz, g, 1, &ids); }
        // Corner chunks get a full cobble floor so no gaps
        if cx.abs() == 3 && cz.abs() == 3 {
            fill(&mut chunk, bx, g-1, bz, bx+15, g-1, bz+15, ids.cobble);
        }
        // Skip interior generation for the outer ring
        if cx < -2 || cx > 2 || cz < -2 || cz > 2 { return chunk; }

        // ── Road grid ─────────────────────────────────────────────────────
        // Runs unconditionally across all interior chunks.
        let (ew_z0, ew_z1) = (-12_i32, -5_i32); // E-W road world Z range
        let (ns_x0, ns_x1) = ( -4_i32,  3_i32); // N-S road world X range

        // E-W road surface + sidewalks
        let ez0 = ew_z0.max(bz); let ez1 = ew_z1.min(bz+15);
        if ez0 <= ez1 {
            fill(&mut chunk, bx, g-1, ez0, bx+15, g-1, ez1, ids.dark_stone);
            let (a,b) = ((ew_z0-2).max(bz), (ew_z0-1).min(bz+15));
            if a <= b { fill(&mut chunk, bx, g-1, a, bx+15, g-1, b, ids.cobble); }
            let (a,b) = ((ew_z1+1).max(bz), (ew_z1+2).min(bz+15));
            if a <= b { fill(&mut chunk, bx, g-1, a, bx+15, g-1, b, ids.cobble); }
        }
        // N-S road surface + sidewalks
        let nx0 = ns_x0.max(bx); let nx1 = ns_x1.min(bx+15);
        if nx0 <= nx1 {
            fill(&mut chunk, nx0, g-1, bz, nx1, g-1, bz+15, ids.dark_stone);
            let (a,b) = ((ns_x0-2).max(bx), (ns_x0-1).min(bx+15));
            if a <= b { fill(&mut chunk, a, g-1, bz, b, g-1, bz+15, ids.cobble); }
            let (a,b) = ((ns_x1+1).max(bx), (ns_x1+2).min(bx+15));
            if a <= b { fill(&mut chunk, a, g-1, bz, b, g-1, bz+15, ids.cobble); }
        }

        // ── Per-chunk content ─────────────────────────────────────────────
        match (cx, cz) {

            // ── (0,0) Central intersection + plaza ───────────────────────
            (0, 0) => {
                // Crosswalk stripes at the intersection
                for vx in ns_x0..=ns_x1 {
                    for vz in ew_z0..=ew_z1 {
                        if vx >= bx && vx <= bx+15 && vz >= bz && vz <= bz+15 {
                            if (vz - ew_z0) % 3 == 0 {
                                chunk.set_voxel(vx, g-1, vz, ids.stone);
                            }
                        }
                    }
                }
                // Central plaza cobble (north half of chunk away from road)
                fill(&mut chunk, bx+4, g-1, bz+4, bx+11, g-1, bz+11, ids.cobble);
                // Fountain: cobble basin + water pool
                fill(&mut chunk, bx+6, g-1, bz+6, bx+9,  g,   bz+9,  ids.cobble);
                fill(&mut chunk, bx+7, g,   bz+7, bx+8,  g,   bz+8,  ids.water);
                // Trees at plaza corners
                tree(&mut chunk, bx+4,  bz+4,  g, &ids);
                tree(&mut chunk, bx+11, bz+4,  g, &ids);
                tree(&mut chunk, bx+4,  bz+11, g, &ids);
                tree(&mut chunk, bx+11, bz+11, g, &ids);
                // Benches
                fill(&mut chunk, bx+6, g, bz+4, bx+9, g, bz+4, ids.wood);
                fill(&mut chunk, bx+6, g, bz+12, bx+9, g, bz+12, ids.wood);
                // Street lamps at plaza corners
                lamp_post(&mut chunk, bx+3,  bz+3,  g, &ids);
                lamp_post(&mut chunk, bx+12, bz+3,  g, &ids);
                lamp_post(&mut chunk, bx+3,  bz+12, g, &ids);
                lamp_post(&mut chunk, bx+12, bz+12, g, &ids);
            }

            // ── (0,-1) Thomas's tent alley south of road ─────────────────
            (0, -1) => {
                // Thomas's tent: plank floor, cobble walls, dark-stone roof
                let (tx, tz) = (bx+3, bz+1);
                fill(&mut chunk, tx, g, tz, tx+6, g, tz+5, ids.plank);
                // Back + side walls
                fill(&mut chunk, tx, g+1, tz+5, tx+6, g+4, tz+5, ids.cobble);
                fill(&mut chunk, tx, g+1, tz,   tx,   g+3, tz+5, ids.cobble);
                fill(&mut chunk, tx+6, g+1, tz, tx+6, g+3, tz+5, ids.cobble);
                // Canvas roof
                fill(&mut chunk, tx, g+4, tz+3, tx+6, g+4, tz+5, ids.dark_stone);
                fill(&mut chunk, tx, g+5, tz+4, tx+6, g+5, tz+5, ids.dark_stone);
                // Tent canvas on open sides
                fill(&mut chunk, tx+1, g+1, tz+5, tx+5, g+3, tz+5, ids.tent_canvas);
                // Rubbish and campfire
                chunk.set_voxel(tx+8, g+1, tz+1, ids.cobble);
                chunk.set_voxel(tx-1, g+1, tz+2, ids.cardboard);
                chunk.set_voxel(tx+3, g, tz+6, ids.cardboard);
                for (fx,fz) in [(tx+9,tz+3),(tx+10,tz+3),(tx+9,tz+4),(tx+10,tz+4)] {
                    chunk.set_voxel(fx, g, fz, ids.cobble);
                }
                chunk.set_voxel(tx+9, g+1, tz+3, ids.dark_stone);
                // Lamp at road edge
                lamp_post(&mut chunk, bx+1, bz+14, g, &ids);
            }

            // ── (0,-2) South block — parked cars + open ground ───────────
            (0, -2) => {
                fill(&mut chunk, bx, g-1, bz+4, bx+15, g-1, bz+15, ids.cobble);
                parked_car(&mut chunk, bx+1, bz+6, g, &ids);
                parked_car(&mut chunk, bx+9, bz+6, g, &ids);
                dumpster(&mut chunk, bx+13, bz+10, g, &ids);
            }

            // ── (-1,-2) Alley block (west) ────────────────────────────────
            (-1, -2) => {
                fill(&mut chunk, bx, g-1, bz+4, bx+15, g-1, bz+15, ids.cobble);
                dumpster(&mut chunk, bx+2, bz+8, g, &ids);
                dumpster(&mut chunk, bx+2, bz+12, g, &ids);
                chunk.set_voxel(bx+6, g, bz+6, ids.cardboard);
                chunk.set_voxel(bx+9, g, bz+9, ids.cobble);
            }

            // ── (1,-2) Encampment (east) ──────────────────────────────────
            (1, -2) => {
                fill(&mut chunk, bx, g-1, bz+4, bx+15, g-1, bz+15, ids.cobble);
                // Three small tents
                for i in 0_i32..3 {
                    let tz = bz+5 + i*4;
                    let tx = bx+3;
                    fill(&mut chunk, tx, g, tz, tx+3, g, tz+2, ids.wood);
                    fill(&mut chunk, tx, g+1, tz, tx+3, g+2, tz, ids.tent_canvas);
                    fill(&mut chunk, tx, g+1, tz+2, tx+3, g+2, tz+2, ids.tent_canvas);
                    fill(&mut chunk, tx, g+3, tz, tx+3, g+3, tz+2, ids.wood);
                    chunk.set_voxel(tx+1, g, tz+3, ids.cardboard);
                }
                // Campfire
                for (fx,fz) in [(bx+10,bz+13),(bx+11,bz+13)] {
                    chunk.set_voxel(fx, g, fz, ids.cobble);
                }
                chunk.set_voxel(bx+10, g+1, bz+13, ids.dark_stone);
            }

            // ── (-2,-2) South-west corner — scrapyard ────────────────────
            (-2, -2) => {
                fill(&mut chunk, bx, g-1, bz+4, bx+15, g-1, bz+15, ids.cobble);
                for (x,z) in [(bx+2,bz+6),(bx+6,bz+8),(bx+10,bz+5),(bx+3,bz+12),(bx+11,bz+13)] {
                    chunk.set_voxel(x, g, z, ids.dark_stone);
                    chunk.set_voxel(x, g+1, z, ids.cobble);
                }
            }

            // ── (2,-2) South-east corner — more parking ───────────────────
            (2, -2) => {
                fill(&mut chunk, bx, g-1, bz+4, bx+15, g-1, bz+15, ids.cobble);
                parked_car(&mut chunk, bx+1, bz+6,  g, &ids);
                parked_car(&mut chunk, bx+1, bz+11, g, &ids);
                parked_car(&mut chunk, bx+8, bz+8,  g, &ids);
            }

            // ── (-1,-1) Ray's Pawnshop ────────────────────────────────────
            (-1, -1) => {
                // Pawnshop: dark stone, 9 wide 6 deep 8 tall
                let (ox, oz, top) = (bx+2, bz+8, g+8);
                walls(&mut chunk, ox, g, oz, ox+8, top, oz+5, ids.dark_stone);
                fill(&mut chunk, ox+1, g+1, oz+1, ox+7, top-1, oz+4, 0);
                fill(&mut chunk, ox, top+1, oz, ox+8, top+1, oz+5, ids.cobble);
                // Barred window
                for vy in [g+2, g+3] {
                    chunk.set_voxel(ox+1, vy, oz, ids.glass);
                    chunk.set_voxel(ox+2, vy, oz, if vy == g+3 { ids.cobble } else { ids.glass });
                    chunk.set_voxel(ox+3, vy, oz, ids.glass);
                }
                // Door
                for vy in g..=g+2 { chunk.set_voxel(ox+6, vy, oz, 0); }
                // Inside shelf
                fill(&mut chunk, ox+1, g, oz+3, ox+7, g, oz+3, ids.wood);
                // Sign above door
                chunk.set_voxel(ox+5, g+5, oz, ids.dark_stone);
                chunk.set_voxel(ox+6, g+5, oz, ids.cobble);
                // Lamp outside
                lamp_post(&mut chunk, ox-1, oz-3, g, &ids);
            }

            // ── (1,-1) Diane's Bodega ─────────────────────────────────────
            (1, -1) => {
                // Bodega: brick, 10 wide 7 deep 8 tall
                let (ox, oz, top) = (bx+1, bz+8, g+8);
                walls(&mut chunk, ox, g, oz, ox+9, top, oz+6, ids.brick);
                fill(&mut chunk, ox+1, g+1, oz+1, ox+8, top-1, oz+5, 0);
                fill(&mut chunk, ox, top+1, oz, ox+9, top+1, oz+6, ids.dark_stone);
                // Big shop window
                fill(&mut chunk, ox+1, g+1, oz, ox+4, g+4, oz, ids.glass);
                // Door
                for vy in g..=g+2 { chunk.set_voxel(ox+7, vy, oz, 0); }
                // Counter
                fill(&mut chunk, ox+1, g, oz+4, ox+8, g, oz+4, ids.wood);
                // Awning
                fill(&mut chunk, ox, g+5, oz-2, ox+9, g+5, oz-1, ids.orange_concrete);
                // Sign post
                col(&mut chunk, ox+4, oz-3, g, g+6, ids.dark_stone);
                chunk.set_voxel(ox+4, g+6, oz-3, ids.brick);
                lamp_post(&mut chunk, ox+9, oz-3, g, &ids);
            }

            // ── (2,-1) East strip — small shops + sidewalk ───────────────
            (2, -1) => {
                // Row of small shops on north side
                let oz = bz+8;
                for i in 0_i32..2 {
                    let ox = bx+1 + i*8;
                    walls(&mut chunk, ox, g, oz, ox+6, g+6, oz+5, ids.white_concrete);
                    fill(&mut chunk, ox+1, g+1, oz+1, ox+5, g+5, oz+4, 0);
                    fill(&mut chunk, ox, g+7, oz, ox+6, g+7, oz+5, ids.cobble);
                    fill(&mut chunk, ox+1, g+1, oz, ox+3, g+3, oz, ids.glass);
                    for vy in g..=g+2 { chunk.set_voxel(ox+5, vy, oz, 0); }
                }
                lamp_post(&mut chunk, bx+7, bz+7, g, &ids);
            }

            // ── (-2,-1) West strip — alley + dumpsters ───────────────────
            (-2, -1) => {
                dumpster(&mut chunk, bx+12, bz+4, g, &ids);
                dumpster(&mut chunk, bx+12, bz+9, g, &ids);
                chunk.set_voxel(bx+8, g, bz+6, ids.cardboard);
                chunk.set_voxel(bx+9, g, bz+11, ids.cobble);
                // Graffiti on east wall
                for vy in [g+2, g+3] {
                    chunk.set_voxel(bx+15, vy, bz+4, ids.brick);
                    chunk.set_voxel(bx+15, vy, bz+5, ids.orange_concrete);
                }
            }

            // ── (-2,0) YC Office campus ───────────────────────────────────
            (-2, 0) => {
                // Wide campus building: 14 wide, 14 deep, 14 tall
                let (ox, oz, top) = (bx+1, bz+1, g+14);
                walls(&mut chunk, ox, g, oz, ox+13, top, oz+13, ids.orange_concrete);
                fill(&mut chunk, ox+1, g+1, oz+1, ox+12, top-1, oz+12, 0);
                fill(&mut chunk, ox, top+1, oz, ox+13, top+1, oz+13, ids.white_concrete);
                // Horizontal window bands every 3 floors
                for fy in [g+2, g+5, g+8, g+11] {
                    for vx in (ox+1..ox+13).step_by(2) {
                        chunk.set_voxel(vx, fy, oz, ids.glass);
                        chunk.set_voxel(vx, fy+1, oz, ids.glass);
                        chunk.set_voxel(vx, fy, oz+13, ids.glass);
                        chunk.set_voxel(vx, fy+1, oz+13, ids.glass);
                    }
                    for vz in (oz+1..oz+13).step_by(2) {
                        chunk.set_voxel(ox, fy, vz, ids.glass);
                        chunk.set_voxel(ox, fy+1, vz, ids.glass);
                        chunk.set_voxel(ox+13, fy, vz, ids.glass);
                        chunk.set_voxel(ox+13, fy+1, vz, ids.glass);
                    }
                }
                // South entrance door
                for vy in g..=g+3 { chunk.set_voxel(ox+6, vy, oz, 0); chunk.set_voxel(ox+7, vy, oz, 0); }
                // Interior desks
                for (dx, dz) in [(ox+3,oz+4),(ox+8,oz+4),(ox+3,oz+9),(ox+8,oz+9)] {
                    fill(&mut chunk, dx, g, dz, dx+2, g, dz+1, ids.wood);
                }
                // "YC" pixel sign on south facade
                let (yy, yz) = (g+11, oz);
                for (vx,vy) in [(ox+3,yy+2),(ox+5,yy+2),(ox+4,yy+1),(ox+4,yy)] {
                    chunk.set_voxel(vx, vy, yz, ids.orange_concrete);
                }
                for (vx,vy) in [(ox+7,yy+2),(ox+8,yy+2),(ox+7,yy+1),(ox+7,yy),(ox+8,yy)] {
                    chunk.set_voxel(vx, vy, yz, ids.orange_concrete);
                }
                // Campus plaza in front
                fill(&mut chunk, ox+3, g-1, oz-4, ox+10, g-1, oz-1, ids.cobble);
                fill(&mut chunk, ox+4, g, oz-3, ox+5, g, oz-3, ids.wood);
                fill(&mut chunk, ox+8, g, oz-3, ox+9, g, oz-3, ids.wood);
                tree(&mut chunk, ox-1, oz+6, g, &ids);
                lamp_post(&mut chunk, ox+1, oz-3, g, &ids);
                lamp_post(&mut chunk, ox+12, oz-3, g, &ids);
            }

            // ── (-2,1) YC North wing — upper offices ──────────────────────
            (-2, 1) => {
                let (ox, oz, top) = (bx+1, bz, g+14);
                walls(&mut chunk, ox, g, oz, ox+13, top, oz+12, ids.orange_concrete);
                fill(&mut chunk, ox+1, g+1, oz+1, ox+12, top-1, oz+11, 0);
                fill(&mut chunk, ox, top+1, oz, ox+13, top+1, oz+12, ids.white_concrete);
                // Mezzanine
                fill(&mut chunk, ox+1, g+6, oz+1, ox+12, g+6, oz+11, ids.white_concrete);
                fill(&mut chunk, ox+1, g+7, oz+1, ox+12, g+7, oz+3, ids.cobble);
                fill(&mut chunk, ox+4, g+7, oz+9, ox+12, g+7, oz+11, ids.wood);
                // Windows on south face
                for fy in [g+2, g+8] {
                    for vx in (ox+1..ox+13).step_by(2) {
                        chunk.set_voxel(vx, fy, oz, ids.glass);
                        chunk.set_voxel(vx, fy+1, oz, ids.glass);
                    }
                }
                tree(&mut chunk, bx+15, bz+14, g, &ids);
            }

            // ── (2,0) VC Tower base ───────────────────────────────────────
            (2, 0) => {
                let (ox, oz, top) = (bx+2, bz+1, g+36);
                // Steel corner columns full height
                for (px,pz) in [(ox,oz),(ox+11,oz),(ox,oz+13),(ox+11,oz+13)] {
                    col(&mut chunk, px, pz, g, top, ids.steel);
                }
                // Glass curtain wall
                for vy in g..=top {
                    for vx in ox+1..ox+11 {
                        chunk.set_voxel(vx, vy, oz, ids.glass);
                        chunk.set_voxel(vx, vy, oz+13, ids.glass);
                    }
                    for vz in oz+1..oz+13 {
                        chunk.set_voxel(ox, vy, vz, ids.glass);
                        chunk.set_voxel(ox+11, vy, vz, ids.glass);
                    }
                }
                // Steel floor bands every 4 floors
                for fy in (g+4..=top).step_by(4) {
                    fill(&mut chunk, ox, fy, oz, ox+11, fy, oz+13.min(bz+15), ids.steel);
                }
                fill(&mut chunk, ox+1, g+1, oz+1, ox+10, top-1, (oz+12).min(bz+14), 0);
                // Ground floor: reception
                fill(&mut chunk, ox+3, g, oz+3, ox+7, g, oz+3, ids.dark_stone);
                chunk.set_voxel(ox+3, g, oz+4, ids.dark_stone);
                fill(&mut chunk, ox+1, g+1, oz+8, ox+10, g+3, oz+8, ids.glass);
                fill(&mut chunk, ox+3, g, oz+10, ox+9, g, oz+10, ids.wood);
                for vy in g..=g+2 {
                    chunk.set_voxel(ox, vy, oz+5, 0);
                    chunk.set_voxel(ox, vy, oz+6, 0);
                }
                fill(&mut chunk, ox-2, g+4, oz+4, ox-1, g+4, oz+7, ids.glass);
                // Forecourt plaza
                fill(&mut chunk, ox-4, g-1, oz+2, ox-1, g-1, oz+11, ids.cobble);
                for bz_ in (oz+3..oz+11).step_by(3) {
                    chunk.set_voxel(ox-2, g, bz_, ids.cobble);
                }
                lamp_post(&mut chunk, ox-3, oz+2,  g, &ids);
                lamp_post(&mut chunk, ox-3, oz+11, g, &ids);
            }

            // ── (2,1) VC Tower upper floors + roof ───────────────────────
            (2, 1) => {
                let (ox, oz, top) = (bx+2, bz, g+36);
                for (px,pz) in [(ox,oz),(ox+11,oz),(ox,oz+12),(ox+11,oz+12)] {
                    col(&mut chunk, px, pz, g, top, ids.steel);
                }
                for vy in g..=top {
                    for vx in ox+1..ox+11 {
                        chunk.set_voxel(vx, vy, oz, ids.glass);
                        if oz+12 <= bz+15 { chunk.set_voxel(vx, vy, oz+12, ids.glass); }
                    }
                    for vz in oz+1..oz+12 {
                        if vz <= bz+15 {
                            chunk.set_voxel(ox, vy, vz, ids.glass);
                            chunk.set_voxel(ox+11, vy, vz, ids.glass);
                        }
                    }
                }
                for fy in (g+4..=top).step_by(4) {
                    fill(&mut chunk, ox, fy, oz, ox+11, fy, (oz+12).min(bz+15), ids.steel);
                }
                fill(&mut chunk, ox+1, g+1, oz+1, ox+10, top-1, (oz+11).min(bz+14), 0);
                // Roof cap + penthouse
                fill(&mut chunk, ox, top+1, oz, ox+11, top+1, (oz+12).min(bz+15), ids.dark_stone);
                walls(&mut chunk, ox+4, top+2, oz+3, ox+7, top+5, (oz+6).min(bz+15), ids.glass);
            }

            // ── (-1,0) Projects apartments (Marcus) ───────────────────────
            (-1, 0) => {
                // Rundown apartment block: 13 wide, 11 deep, 16 tall
                let (ox, oz, top) = (bx+1, bz+3, g+16);
                walls(&mut chunk, ox, g, oz, ox+12, top, oz+10, ids.white_concrete);
                fill(&mut chunk, ox+1, g+1, oz+1, ox+11, top-1, oz+9, 0);
                fill(&mut chunk, ox, top+1, oz, ox+12, top+1, oz+10, ids.dark_stone);
                for fy in [g+4, g+8, g+12] {
                    fill(&mut chunk, ox+1, fy, oz+1, ox+11, fy, oz+9, ids.cobble);
                }
                for vy in [g+2, g+6, g+10, g+14] {
                    for vx in (ox+1..=ox+11).step_by(3) {
                        chunk.set_voxel(vx, vy, oz, ids.glass);
                        chunk.set_voxel(vx, vy+1, oz, ids.glass);
                    }
                }
                // Marcus stairwell door
                for vy in g..=g+2 { chunk.set_voxel(ox+1, vy, oz, 0); }
                fill(&mut chunk, ox+3, g+1, oz+1, ox+3, g+3, oz+3, ids.cobble);
                fill(&mut chunk, ox+1, g+1, oz+4, ox+2, g+3, oz+6, ids.dark_stone);
                chunk.set_voxel(ox+1, g, oz+5, ids.wood);
                chunk.set_voxel(ox+2, g, oz+5, ids.wood);
                lamp_post(&mut chunk, ox-1, oz-2, g, &ids);
                // Trees along building side
                tree(&mut chunk, ox+13, oz+2, g, &ids);
                tree(&mut chunk, ox+13, oz+8, g, &ids);
            }

            // ── (-1,1) North road + mid-rise residential ──────────────────
            (-1, 1) => {
                // Mid-rise: 10 wide, 10 deep, 12 tall
                let (ox, oz, top) = (bx+1, bz+4, g+12);
                walls(&mut chunk, ox, g, oz, ox+9, top, oz+9, ids.white_concrete);
                fill(&mut chunk, ox+1, g+1, oz+1, ox+8, top-1, oz+8, 0);
                fill(&mut chunk, ox, top+1, oz, ox+9, top+1, oz+9, ids.cobble);
                for fy in [g+4, g+8] {
                    fill(&mut chunk, ox+1, fy, oz+1, ox+8, fy, oz+8, ids.cobble);
                }
                for vy in (g+2..top).step_by(4) {
                    for vx in (ox..=ox+9).step_by(3) {
                        chunk.set_voxel(vx, vy, oz, ids.glass);
                        chunk.set_voxel(vx, vy+1, oz, ids.glass);
                    }
                }
                for vy in g..=g+2 { chunk.set_voxel(ox+4, vy, oz, 0); chunk.set_voxel(ox+5, vy, oz, 0); }
                // Rooftop water tower
                col(&mut chunk, ox+7, oz+7, top+2, top+5, ids.dark_stone);
            }

            // ── (1,0) East road + shops ───────────────────────────────────
            (1, 0) => {
                // Corner shop row (east side)
                let oz = bz+4;
                for i in 0_i32..2 {
                    let ox = bx+8 + i*0; // single building
                    if i == 0 {
                        walls(&mut chunk, bx+9, g, oz, bx+14, g+6, oz+8, ids.brick);
                        fill(&mut chunk, bx+10, g+1, oz+1, bx+13, g+5, oz+7, 0);
                        fill(&mut chunk, bx+9, g+7, oz, bx+14, g+7, oz+8, ids.dark_stone);
                        fill(&mut chunk, bx+10, g+1, oz, bx+12, g+3, oz, ids.glass);
                        for vy in g..=g+2 { chunk.set_voxel(bx+13, vy, oz, 0); }
                        fill(&mut chunk, bx+10, g, oz+6, bx+13, g, oz+6, ids.wood);
                    }
                }
                // VC forecourt on west side
                fill(&mut chunk, bx, g-1, bz+3, bx+3, g-1, bz+12, ids.cobble);
                for bz_ in [bz+4, bz+7, bz+10] { chunk.set_voxel(bx+1, g, bz_, ids.cobble); }
                lamp_post(&mut chunk, bx+2, bz+2, g, &ids);
                lamp_post(&mut chunk, bx+2, bz+13, g, &ids);
            }

            // ── (1,1) East upper — warehouse ─────────────────────────────
            (1, 1) => {
                let (ox, oz, top) = (bx+2, bz+2, g+9);
                walls(&mut chunk, ox, g, oz, ox+12, top, oz+12, ids.white_concrete);
                fill(&mut chunk, ox+1, g+1, oz+1, ox+11, top-1, oz+11, 0);
                fill(&mut chunk, ox+1, g+5, oz+1, ox+11, g+5, oz+11, ids.cobble);
                fill(&mut chunk, ox, top+1, oz, ox+12, top+1, oz+12, ids.cobble);
                for vx in (ox+1..ox+12).step_by(2) {
                    chunk.set_voxel(vx, g+2, oz, ids.glass);
                    chunk.set_voxel(vx, g+3, oz, ids.glass);
                    chunk.set_voxel(vx, g+7, oz, ids.glass);
                    chunk.set_voxel(vx, g+8, oz, ids.glass);
                }
                for vx in ox+1..=ox+5 { for vy in g..=g+2 { chunk.set_voxel(vx, vy, oz, 0); } }
                fill(&mut chunk, ox+10, top+2, oz+9, ox+11, top+3, oz+10, ids.dark_stone);
                lamp_post(&mut chunk, ox+13, oz+6, g, &ids);
            }

            // ── (-2,2) West park — fountain + trees ───────────────────────
            (-2, 2) => {
                fill(&mut chunk, bx+1, g-1, bz+1, bx+14, g-1, bz+14, ids.cobble);
                // Paths
                fill(&mut chunk, bx+7, g-1, bz+1, bx+8, g-1, bz+14, ids.stone);
                fill(&mut chunk, bx+1, g-1, bz+7, bx+14, g-1, bz+8, ids.stone);
                // Fountain
                fill(&mut chunk, bx+6, g-1, bz+6, bx+9, g, bz+9, ids.cobble);
                fill(&mut chunk, bx+7, g, bz+7, bx+8, g, bz+8, ids.water);
                // Trees in each quadrant
                for (tx,tz) in [(bx+3,bz+3),(bx+12,bz+3),(bx+3,bz+12),(bx+12,bz+12)] {
                    tree(&mut chunk, tx, tz, g, &ids);
                }
                // Benches
                fill(&mut chunk, bx+6, g, bz+5, bx+9, g, bz+5, ids.wood);
                fill(&mut chunk, bx+6, g, bz+11, bx+9, g, bz+11, ids.wood);
                lamp_post(&mut chunk, bx+5, bz+5, g, &ids);
                lamp_post(&mut chunk, bx+10, bz+10, g, &ids);
            }

            // ── (-1,2) North road + community plaza ───────────────────────
            (-1, 2) => {
                fill(&mut chunk, bx+2, g-1, bz+2, bx+13, g-1, bz+13, ids.cobble);
                fill(&mut chunk, bx+2, g-1, bz+2, bx+13, g-1, bz+2, ids.stone);
                fill(&mut chunk, bx+2, g-1, bz+13, bx+13, g-1, bz+13, ids.stone);
                fill(&mut chunk, bx+2, g-1, bz+3, bx+2, g-1, bz+12, ids.stone);
                fill(&mut chunk, bx+13, g-1, bz+3, bx+13, g-1, bz+12, ids.stone);
                col(&mut chunk, bx+7, bz+12, g, g+5, ids.dark_stone);
                chunk.set_voxel(bx+7, g+5, bz+13, ids.stone);
                chunk.set_voxel(bx+7, g+5, bz+14, ids.lamp);
                fill(&mut chunk, bx+3, g, bz+2, bx+5, g, bz+2, ids.wood);
                fill(&mut chunk, bx+10, g, bz+2, bx+12, g, bz+2, ids.wood);
                lamp_post(&mut chunk, bx+2, bz+2, g, &ids);
                lamp_post(&mut chunk, bx+13, bz+2, g, &ids);
                tree(&mut chunk, bx+4, bz+8, g, &ids);
                tree(&mut chunk, bx+11, bz+8, g, &ids);
            }

            // ── (0,2) North park — open green ─────────────────────────────
            (0, 2) => {
                fill(&mut chunk, bx+1, g-1, bz+1, bx+14, g-1, bz+14, ids.cobble);
                fill(&mut chunk, bx+7, g-1, bz+1, bx+8, g-1, bz+14, ids.stone);
                fill(&mut chunk, bx+1, g-1, bz+7, bx+14, g-1, bz+8, ids.stone);
                // Obelisk
                fill(&mut chunk, bx+6, g, bz+6, bx+8, g+1, bz+8, ids.stone);
                fill(&mut chunk, bx+6, g+2, bz+6, bx+7, g+7, bz+7, ids.dark_stone);
                chunk.set_voxel(bx+6, g+8, bz+6, ids.stone);
                // Trees scattered
                for (tx,tz) in [(bx+3,bz+3),(bx+12,bz+3),(bx+3,bz+12),(bx+12,bz+12),(bx+10,bz+7)] {
                    tree(&mut chunk, tx, tz, g, &ids);
                }
                fill(&mut chunk, bx+3, g, bz+7, bx+5, g, bz+7, ids.wood);
                fill(&mut chunk, bx+10, g, bz+7, bx+12, g, bz+7, ids.wood);
                lamp_post(&mut chunk, bx+5, bz+13, g, &ids);
            }

            // ── (1,2) North-east park + apartment ────────────────────────
            (1, 2) => {
                // Small apartment on north side
                let (ox, oz, top) = (bx+2, bz+4, g+14);
                walls(&mut chunk, ox, g, oz, ox+11, top, oz+10, ids.white_concrete);
                fill(&mut chunk, ox+1, g+1, oz+1, ox+10, top-1, oz+9, 0);
                fill(&mut chunk, ox, top+1, oz, ox+11, top+1, oz+10, ids.dark_stone);
                for fy in [g+4, g+8, g+12] {
                    fill(&mut chunk, ox+1, fy, oz+1, ox+10, fy, oz+9, ids.cobble);
                }
                for vx in (ox..=ox+11).step_by(3) {
                    let mut vy = g+2;
                    while vy < top {
                        chunk.set_voxel(vx, vy, oz, ids.glass);
                        if vy+1 < top { chunk.set_voxel(vx, vy+1, oz, ids.glass); }
                        vy += 4;
                    }
                }
                for vy in g..=g+2 { chunk.set_voxel(ox+5, vy, oz, 0); chunk.set_voxel(ox+6, vy, oz, 0); }
                col(&mut chunk, ox+10, oz+9, top+2, top+6, ids.dark_stone);
                // Park in south part
                fill(&mut chunk, bx+1, g-1, bz+1, bx+14, g-1, bz+3, ids.cobble);
                tree(&mut chunk, bx+4, bz+2, g, &ids);
                tree(&mut chunk, bx+11, bz+2, g, &ids);
            }

            // ── (2,2) East park ───────────────────────────────────────────
            (2, 2) => {
                fill(&mut chunk, bx+1, g-1, bz+1, bx+14, g-1, bz+14, ids.cobble);
                fill(&mut chunk, bx+7, g-1, bz+1, bx+8, g-1, bz+14, ids.stone);
                fill(&mut chunk, bx+1, g-1, bz+7, bx+14, g-1, bz+8, ids.stone);
                for (tx,tz) in [(bx+3,bz+3),(bx+12,bz+3),(bx+3,bz+12),(bx+12,bz+12)] {
                    tree(&mut chunk, tx, tz, g, &ids);
                }
                fill(&mut chunk, bx+5, g, bz+5, bx+6, g, bz+5, ids.wood);
                fill(&mut chunk, bx+9, g, bz+5, bx+10, g, bz+5, ids.wood);
                lamp_post(&mut chunk, bx+5, bz+10, g, &ids);
            }

            // ── (-2,-2..+2) West boundary strip + alley wall ─────────────
            (-2, _) => {
                // Alley wall on east face
                fill(&mut chunk, bx+14, g, bz, bx+15, g+5, bz+15, ids.dark_stone);
            }

            // ── (2, -2..+2) East boundary strip ──────────────────────────
            (2, _) => {
                fill(&mut chunk, bx, g, bz, bx+1, g+5, bz+15, ids.dark_stone);
            }

            _ => {}
        }

        chunk
    }
}
