use adblock::{Engine, FilterSet, lists::ParseOptions, request::Request};
use serde_json::{Value, json};
use std::cell::RefCell;

thread_local! {
    static ENGINE: RefCell<Option<Engine>> = const { RefCell::new(None) };
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

// ABI privada y síncrona. El llamador reserva y libera exactamente el mismo tamaño.
#[unsafe(no_mangle)]
pub extern "C" fn lab_alloc(size: usize) -> *mut u8 {
    let bytes = vec![0u8; size].into_boxed_slice();
    Box::into_raw(bytes) as *mut u8
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn lab_free(pointer: *mut u8, size: usize) {
    unsafe {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
            pointer, size,
        )));
    }
}

fn run(value: Value) -> Result<Value, String> {
    match value["op"].as_str().unwrap_or("") {
        "init" => {
            let text = value["filters"].as_str().ok_or("filters missing")?;
            let mut set = FilterSet::new(true);
            set.add_filter_list(text.to_owned(), ParseOptions::default());
            ENGINE.with(|state| *state.borrow_mut() = Some(Engine::new_with_filter_set(set)));
            Ok(json!({"ready":true}))
        }
        "check" => ENGINE.with(|state| {
            let state = state.borrow();
            let engine = state.as_ref().ok_or("engine not initialized")?;
            let request = Request::new(
                value["url"].as_str().unwrap_or(""),
                value["source"].as_str().unwrap_or(""),
                value["kind"].as_str().unwrap_or("other"),
                "get",
            )
            .map_err(|e| format!("{e:?}"))?;
            let result = engine.check_network_request(&request);
            Ok(json!({"blocked":result.should_block(),"rewrittenUrl":result.rewritten_url}))
        }),
        "cosmetic" => ENGINE.with(|state| {
            let state = state.borrow();
            let engine = state.as_ref().ok_or("engine not initialized")?;
            let result = engine.url_cosmetic_resources(value["url"].as_str().unwrap_or(""));
            serde_json::to_value(result).map_err(|e| e.to_string())
        }),
        _ => Err("unknown operation".to_string()),
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn lab_run(pointer: *const u8, size: usize) {
    let bytes = unsafe { std::slice::from_raw_parts(pointer, size) };
    let result = serde_json::from_slice(bytes)
        .map_err(|e| e.to_string())
        .and_then(run);
    let value = result.unwrap_or_else(|error| json!({"error":error}));
    OUTPUT.with(|output| *output.borrow_mut() = serde_json::to_vec(&value).unwrap());
}

#[unsafe(no_mangle)]
pub extern "C" fn lab_output_ptr() -> *const u8 {
    OUTPUT.with(|output| output.borrow().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn lab_output_len() -> usize {
    OUTPUT.with(|output| output.borrow().len())
}
