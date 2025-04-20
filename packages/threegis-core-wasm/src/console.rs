use wasm_bindgen::prelude::*;

// This allows us to access console.log from JS
#[wasm_bindgen]
extern "C" {
    // Use `js_namespace` to bind `console.log(..)` instead of just `log(..)`
    #[wasm_bindgen(js_namespace = console)]
    pub fn log(s: &str);
}

// Note: The console_log macro is defined in lib.rs to avoid duplication
