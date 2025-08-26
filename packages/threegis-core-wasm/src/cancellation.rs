use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use lazy_static::lazy_static;
use wasm_bindgen::prelude::*;

pub struct CancellationToken {
    pub id: String,
    pub is_cancelled: Arc<Mutex<bool>>,
}

impl CancellationToken {
    pub fn new(id: String) -> Self {
        Self {
            id,
            is_cancelled: Arc::new(Mutex::new(false)),
        }
    }
    
    pub fn cancel(&self) {
        if let Ok(mut cancelled) = self.is_cancelled.lock() {
            *cancelled = true;
        }
    }
    
    pub fn is_cancelled(&self) -> bool {
        self.is_cancelled.lock().map(|guard| *guard).unwrap_or(true)
    }
    
    pub fn throw_if_cancelled(&self) -> Result<(), String> {
        if self.is_cancelled() {
            Err(format!("Operation {} was cancelled", self.id))
        } else {
            Ok(())
        }
    }
}

pub struct CancellationManager {
    tokens: HashMap<String, CancellationToken>,
}

impl CancellationManager {
    pub fn new() -> Self {
        Self {
            tokens: HashMap::new(),
        }
    }
    
    pub fn create_token(&mut self, id: String) -> CancellationToken {
        // Cancel any existing token with the same ID
        if let Some(existing) = self.tokens.get(&id) {
            existing.cancel();
        }
        
        let token = CancellationToken::new(id.clone());
        self.tokens.insert(id.clone(), token);
        self.tokens.get(&id).unwrap().clone()
    }
    
    pub fn cancel_token(&mut self, id: &str) {
        if let Some(token) = self.tokens.get(id) {
            token.cancel();
        }
    }
    
    pub fn get_token(&self, id: &str) -> Option<&CancellationToken> {
        self.tokens.get(id)
    }
    
    pub fn cleanup_token(&mut self, id: &str) {
        self.tokens.remove(id);
    }
}

lazy_static! {
    static ref GLOBAL_CANCELLATION_MANAGER: Arc<Mutex<CancellationManager>> = 
        Arc::new(Mutex::new(CancellationManager::new()));
}

impl Clone for CancellationToken {
    fn clone(&self) -> Self {
        Self {
            id: self.id.clone(),
            is_cancelled: Arc::clone(&self.is_cancelled),
        }
    }
}

#[wasm_bindgen]
pub fn create_cancellation_token(id: &str) -> String {
    if let Ok(mut manager) = GLOBAL_CANCELLATION_MANAGER.lock() {
        let token = manager.create_token(id.to_string());
        token.id
    } else {
        id.to_string()
    }
}

#[wasm_bindgen]
pub fn cancel_operation(id: &str) -> bool {
    if let Ok(mut manager) = GLOBAL_CANCELLATION_MANAGER.lock() {
        manager.cancel_token(id);
        true
    } else {
        false
    }
}

#[wasm_bindgen]
pub fn cleanup_cancellation_token(id: &str) -> bool {
    if let Ok(mut manager) = GLOBAL_CANCELLATION_MANAGER.lock() {
        manager.cleanup_token(id);
        true
    } else {
        false
    }
}

pub fn get_cancellation_token(id: &str) -> Option<CancellationToken> {
    if let Ok(manager) = GLOBAL_CANCELLATION_MANAGER.lock() {
        manager.get_token(id).cloned()
    } else {
        None
    }
}