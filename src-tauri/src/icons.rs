//! Iconos de Windows: se piden a la lista de imágenes del Shell, que es lo que usa el Explorador. Así un acceso
//! directo (.lnk, .url, de Office, de Roblox…) muestra exactamente su icono, a tamaño grande y sin la flechita.
use base64::Engine;

fn to_data_url(w: u32, h: u32, rgba: &[u8]) -> Option<String> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut wr = enc.write_header().ok()?;
        wr.write_image_data(rgba).ok()?;
    }
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(out)))
}

/// Recorta los bordes transparentes (el icono grande del Shell viene centrado en un lienzo de 256 px).
fn crop(w: u32, h: u32, rgba: Vec<u8>) -> (u32, u32, Vec<u8>) {
    let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0u32, 0u32);
    for y in 0..h {
        for x in 0..w {
            if rgba[((y * w + x) * 4 + 3) as usize] > 8 {
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x);
                y1 = y1.max(y);
            }
        }
    }
    if x1 < x0 || y1 < y0 {
        return (w, h, rgba);
    }
    // se deja un cuadrado centrado para que todos los iconos tengan la misma proporción
    let side = (x1 - x0 + 1).max(y1 - y0 + 1);
    let cx = (x0 + x1) / 2;
    let cy = (y0 + y1) / 2;
    let sx = cx.saturating_sub(side / 2).min(w.saturating_sub(side));
    let sy = cy.saturating_sub(side / 2).min(h.saturating_sub(side));
    let side = side.min(w).min(h);
    let mut out = vec![0u8; (side * side * 4) as usize];
    for y in 0..side {
        let src = (((sy + y) * w + sx) * 4) as usize;
        let dst = (y * side * 4) as usize;
        out[dst..dst + (side * 4) as usize].copy_from_slice(&rgba[src..src + (side * 4) as usize]);
    }
    (side, side, out)
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::ffi::c_void;
    use std::mem::size_of;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL, FILE_FLAGS_AND_ATTRIBUTES};
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Controls::{IImageList, ILD_TRANSPARENT};
    use windows::Win32::UI::Shell::*;
    use windows::Win32::UI::WindowsAndMessaging::*;

    const SHIL_EXTRALARGE: i32 = 2;
    const SHIL_JUMBO: i32 = 4;

    fn bgra_bits(dc: HDC, bmp: HBITMAP, w: i32, h: i32) -> Option<Vec<u8>> {
        unsafe {
            let mut bmi = BITMAPINFO::default();
            bmi.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
            bmi.bmiHeader.biWidth = w;
            bmi.bmiHeader.biHeight = -h; // de arriba hacia abajo
            bmi.bmiHeader.biPlanes = 1;
            bmi.bmiHeader.biBitCount = 32;
            bmi.bmiHeader.biCompression = BI_RGB.0;
            let mut buf = vec![0u8; (w * h * 4) as usize];
            let lines = GetDIBits(dc, bmp, 0, h as u32, Some(buf.as_mut_ptr() as *mut c_void), &mut bmi, DIB_RGB_COLORS);
            if lines == 0 { None } else { Some(buf) }
        }
    }

    /// HICON → (ancho, alto, RGBA con alfa recto)
    fn hicon_to_rgba(icon: HICON) -> Option<(u32, u32, Vec<u8>)> {
        unsafe {
            let mut info = ICONINFO::default();
            GetIconInfo(icon, &mut info).ok()?;
            let color = info.hbmColor;
            let mask = info.hbmMask;
            let result = (|| {
                if color.is_invalid() {
                    return None;
                }
                let mut bm = BITMAP::default();
                if GetObjectW(color, size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as *mut c_void)) == 0 {
                    return None;
                }
                let (w, h) = (bm.bmWidth, bm.bmHeight.abs());
                if w < 1 || h < 1 || w > 1024 || h > 1024 {
                    return None;
                }
                let dc = GetDC(HWND::default());
                let mut data = bgra_bits(dc, color, w, h);
                let mut mask_bits = None;
                if let Some(d) = data.as_ref() {
                    if !d.chunks_exact(4).any(|p| p[3] != 0) && !mask.is_invalid() {
                        mask_bits = bgra_bits(dc, mask, w, h);
                    }
                }
                ReleaseDC(HWND::default(), dc);
                let d = data.as_mut()?;
                if !d.chunks_exact(4).any(|p| p[3] != 0) {
                    // icono sin canal alfa: la transparencia está en la máscara (negro = opaco)
                    for (i, p) in d.chunks_exact_mut(4).enumerate() {
                        let opaque = match &mask_bits {
                            Some(m) => m[i * 4] == 0 && m[i * 4 + 1] == 0 && m[i * 4 + 2] == 0,
                            None => true,
                        };
                        p[3] = if opaque { 255 } else { 0 };
                    }
                }
                for p in d.chunks_exact_mut(4) {
                    p.swap(0, 2); // BGRA → RGBA
                }
                Some((w as u32, h as u32, data.unwrap()))
            })();
            if !color.is_invalid() {
                let _ = DeleteObject(color);
            }
            if !mask.is_invalid() {
                let _ = DeleteObject(mask);
            }
            result
        }
    }

    pub fn shell_icon(path: &str, is_dir: bool, exists: bool) -> Option<String> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
            let mut sfi = SHFILEINFOW::default();
            let mut flags = SHGFI_SYSICONINDEX;
            let attrs: FILE_FLAGS_AND_ATTRIBUTES = if is_dir { FILE_ATTRIBUTE_DIRECTORY } else { FILE_ATTRIBUTE_NORMAL };
            if !exists {
                flags |= SHGFI_USEFILEATTRIBUTES; // sin el archivo, solo el icono de su tipo
            }
            let r = SHGetFileInfoW(PCWSTR(wide.as_ptr()), attrs, Some(&mut sfi), size_of::<SHFILEINFOW>() as u32, flags);
            if r == 0 {
                return None;
            }
            for list_kind in [SHIL_JUMBO, SHIL_EXTRALARGE] {
                let list: IImageList = match SHGetImageList(list_kind) {
                    Ok(l) => l,
                    Err(_) => continue,
                };
                let icon = match list.GetIcon(sfi.iIcon, ILD_TRANSPARENT.0) {
                    Ok(i) => i,
                    Err(_) => continue,
                };
                let got = hicon_to_rgba(icon);
                let _ = DestroyIcon(icon);
                if let Some((w, h, rgba)) = got {
                    if rgba.chunks_exact(4).any(|p| p[3] > 8) {
                        let (w, h, rgba) = crop(w, h, rgba);
                        return to_data_url(w, h, &rgba);
                    }
                }
            }
            None
        }
    }

    pub fn open(path: &str) -> bool {
        unsafe {
            let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
            let op: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();
            let r = ShellExecuteW(HWND::default(), PCWSTR(op.as_ptr()), PCWSTR(wide.as_ptr()), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL);
            r.0 as isize > 32
        }
    }
}

/// Icono como data URL PNG (o None si el sistema no lo entrega: la interfaz dibuja uno genérico).
pub fn get(path: &str, is_dir: bool) -> Option<String> {
    #[cfg(windows)]
    {
        let exists = std::fs::metadata(path).is_ok();
        let dir = if exists { std::fs::metadata(path).map(|m| m.is_dir()).unwrap_or(is_dir) } else { is_dir };
        win::shell_icon(path, dir, exists)
    }
    #[cfg(not(windows))]
    {
        let _ = (path, is_dir);
        None
    }
}

/// Abre un archivo, carpeta o acceso directo con el programa asociado.
pub fn open(path: &str) -> bool {
    #[cfg(windows)]
    {
        win::open(path)
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open").arg(path).spawn().is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recorta_al_contenido_y_deja_un_cuadrado() {
        // lienzo 10x10 transparente con un bloque opaco de 4x2 en (3,4)
        let (w, h) = (10u32, 10u32);
        let mut px = vec![0u8; (w * h * 4) as usize];
        for y in 4..6 {
            for x in 3..7 {
                let i = ((y * w + x) * 4) as usize;
                px[i..i + 4].copy_from_slice(&[10, 20, 30, 255]);
            }
        }
        let (cw, ch, out) = crop(w, h, px);
        assert_eq!((cw, ch), (4, 4));
        assert_eq!(out.len(), 4 * 4 * 4);
        assert!(out.chunks_exact(4).filter(|p| p[3] == 255).count() == 8);
    }

    #[test]
    fn genera_un_png_valido() {
        let url = to_data_url(2, 2, &[255u8; 16]).unwrap();
        assert!(url.starts_with("data:image/png;base64,iVBOR"));
    }
}
