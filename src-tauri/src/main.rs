// En Windows no se abre una consola junto al programa
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mis_cercas_lib::run()
}
