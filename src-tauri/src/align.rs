// Geometría pura para alinear, igualar y ordenar cercas. Una caja es { id, x, y, w, h } (píxeles lógicos).
pub const GAP: i32 = 12;
pub const THRESHOLD: i32 = 14;

#[derive(Clone, Debug, PartialEq)]
pub struct B {
    pub id: String,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[derive(Clone, Copy, Debug)]
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

fn nearest(value: i32, targets: &[i32], thr: i32) -> Option<i32> {
    let mut best: Option<i32> = None;
    for &t in targets {
        let d = (t - value).abs();
        if d <= thr && best.map(|b| d < (b - value).abs()).unwrap_or(true) {
            best = Some(t);
        }
    }
    best
}

/// Imán: ajusta una cerca recién movida o redimensionada a los bordes de las demás y de la pantalla.
pub fn snap(b: &B, prev: Option<&B>, others: &[B], wa: Area, collapsed: bool) -> B {
    let thr = THRESHOLD;
    let mut out = b.clone();
    let mut ls = vec![wa.x];
    let mut rs = vec![wa.x + wa.w];
    let mut ts = vec![wa.y];
    let mut bs = vec![wa.y + wa.h];
    for o in others {
        ls.extend([o.x, o.x + o.w + GAP]);
        rs.extend([o.x + o.w, o.x - GAP]);
        ts.extend([o.y, o.y + o.h + GAP]);
        bs.extend([o.y + o.h, o.y - GAP]);
    }
    let resized = prev.map(|p| b.w != p.w || (!collapsed && b.h != p.h)).unwrap_or(false);
    let widths: Vec<i32> = others.iter().map(|o| o.w).collect();
    let heights: Vec<i32> = others.iter().map(|o| o.h).collect();

    let left_moved = prev.map(|p| b.x != p.x).unwrap_or(true);
    let right_moved = prev.map(|p| b.x + b.w != p.x + p.w).unwrap_or(true);
    if !resized {
        let l = nearest(b.x, &ls, thr);
        let r = nearest(b.x + b.w, &rs, thr);
        let dl = l.map(|v| (v - b.x).abs()).unwrap_or(i32::MAX);
        let dr = r.map(|v| (v - (b.x + b.w)).abs()).unwrap_or(i32::MAX);
        if let (true, Some(l)) = (dl <= dr, l) {
            out.x = l;
        } else if let Some(r) = r {
            out.x = r - b.w;
        }
    } else {
        if left_moved {
            if let Some(l) = nearest(b.x, &ls, thr) {
                out.w = b.x + b.w - l;
                out.x = l;
            }
        }
        if right_moved {
            let r = nearest(b.x + b.w, &rs, thr);
            let eq = nearest(b.w, &widths, thr);
            match (r, eq) {
                (Some(r), e) if e.map(|e| (r - (b.x + b.w)).abs() <= (e - b.w).abs()).unwrap_or(true) => out.w = r - out.x,
                (_, Some(e)) => out.w = e,
                _ => {}
            }
        }
    }

    let top_moved = prev.map(|p| b.y != p.y).unwrap_or(true);
    let bottom_moved = prev.map(|p| b.y + b.h != p.y + p.h).unwrap_or(true);
    if !resized {
        let t = nearest(b.y, &ts, thr);
        let bt = if collapsed { None } else { nearest(b.y + b.h, &bs, thr) };
        let dt = t.map(|v| (v - b.y).abs()).unwrap_or(i32::MAX);
        let db = bt.map(|v| (v - (b.y + b.h)).abs()).unwrap_or(i32::MAX);
        if let (true, Some(t)) = (dt <= db, t) {
            out.y = t;
        } else if let Some(bt) = bt {
            out.y = bt - b.h;
        }
    } else if !collapsed {
        if top_moved {
            if let Some(t) = nearest(b.y, &ts, thr) {
                out.h = b.y + b.h - t;
                out.y = t;
            }
        }
        if bottom_moved {
            let bt = nearest(b.y + b.h, &bs, thr);
            let eq = nearest(b.h, &heights, thr);
            match (bt, eq) {
                (Some(v), e) if e.map(|e| (v - (b.y + b.h)).abs() <= (e - b.h).abs()).unwrap_or(true) => out.h = v - out.y,
                (_, Some(e)) => out.h = e,
                _ => {}
            }
        }
    }
    out
}

fn map_others(list: &[B], r: &B, f: impl Fn(&B) -> B) -> Vec<B> {
    list.iter().map(|b| if b.id == r.id { b.clone() } else { f(b) }).collect()
}

pub fn op(name: &str, list: &[B], r: &B) -> Option<Vec<B>> {
    Some(match name {
        "size" => map_others(list, r, |b| B { w: r.w, h: r.h, ..b.clone() }),
        "width" => map_others(list, r, |b| B { w: r.w, ..b.clone() }),
        "height" => map_others(list, r, |b| B { h: r.h, ..b.clone() }),
        "left" => map_others(list, r, |b| B { x: r.x, ..b.clone() }),
        "top" => map_others(list, r, |b| B { y: r.y, ..b.clone() }),
        "right" => map_others(list, r, |b| B { x: r.x + r.w - b.w, ..b.clone() }),
        "bottom" => map_others(list, r, |b| B { y: r.y + r.h - b.h, ..b.clone() }),
        "column" => stack_column(list, r),
        _ => return None,
    })
}

pub fn stack_column(list: &[B], r: &B) -> Vec<B> {
    let mut rest: Vec<B> = list.iter().filter(|b| b.id != r.id).cloned().collect();
    rest.sort_by(|a, b| a.y.cmp(&b.y).then(a.x.cmp(&b.x)));
    let mut y = r.y + r.h + GAP;
    let mut out = vec![r.clone()];
    for b in rest {
        let h = b.h;
        out.push(B { x: r.x, w: r.w, y, ..b });
        y += h + GAP;
    }
    out
}

pub fn tidy_grid(list: &[B], r: &B, wa: Area) -> Vec<B> {
    let w = r.w.min(wa.w - GAP * 2);
    let h = r.h.min(wa.h - GAP * 2);
    let row_h = ((h as f64 / 2.0).round() as i32).max(1);
    let mut sorted: Vec<B> = list.to_vec();
    let rowk = |b: &B| (b.y as f64 / row_h as f64).round() as i32;
    sorted.sort_by(|a, b| rowk(a).cmp(&rowk(b)).then(a.x.cmp(&b.x)));
    let per_row = (((wa.w - GAP) / (w + GAP)).max(1)) as usize;
    sorted
        .into_iter()
        .enumerate()
        .map(|(i, b)| B { w, h, x: wa.x + GAP + (i % per_row) as i32 * (w + GAP), y: wa.y + GAP + (i / per_row) as i32 * (h + GAP), ..b })
        .collect()
}

pub fn common_size(list: &[B]) -> B {
    let mut best = list[0].clone();
    let mut best_n = 0;
    let mut count: std::collections::HashMap<(i32, i32), usize> = Default::default();
    for b in list {
        let n = count.entry((b.w, b.h)).or_insert(0);
        *n += 1;
        if *n > best_n {
            best_n = *n;
            best = b.clone();
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;
    fn bx(id: &str, x: i32, y: i32, w: i32, h: i32) -> B {
        B { id: id.into(), x, y, w, h }
    }
    const WA: Area = Area { x: 0, y: 0, w: 1920, h: 1040 };

    #[test]
    fn snap_to_neighbour_edge() {
        let o = bx("o", 100, 100, 300, 200);
        let moved = bx("m", 100 + 300 + GAP + 5, 98, 300, 200);
        let r = snap(&moved, Some(&bx("m", 900, 500, 300, 200)), &[o], WA, false);
        assert_eq!(r.x, 100 + 300 + GAP);
        assert_eq!(r.y, 100);
    }
    #[test]
    fn right_edge_snaps_to_right_not_gap() {
        let o = bx("o", 500, 100, 300, 200);
        let moved = bx("m", 800 - 300 + 4, 400, 300, 200);
        let r = snap(&moved, Some(&bx("m", 0, 0, 300, 200)), &[o], WA, false);
        assert_eq!(r.x + r.w, 800);
    }
    #[test]
    fn column_and_tidy() {
        let l = vec![bx("a", 0, 0, 200, 100), bx("b", 500, 300, 250, 150), bx("c", 10, 600, 180, 90)];
        let c = stack_column(&l, &l[0]);
        assert_eq!(c[1].x, 0);
        assert_eq!(c[1].w, 200);
        assert_eq!(c[1].y, 100 + GAP);
        let t = tidy_grid(&l, &common_size(&l), WA);
        assert!(t.iter().all(|b| b.w == 200 && b.h == 100));
    }
}
