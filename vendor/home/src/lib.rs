use std::path::PathBuf;

pub fn home_dir() -> Option<PathBuf> {
    None
}

pub fn cargo_home() -> Result<PathBuf, std::io::Error> {
    Ok(PathBuf::from("/"))
}

pub fn rustup_home() -> Result<PathBuf, std::io::Error> {
    Ok(PathBuf::from("/"))
}

pub fn env_home_dir() -> Option<PathBuf> {
    None
}
