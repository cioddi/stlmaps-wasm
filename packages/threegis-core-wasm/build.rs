fn main() {
    // Only use supported linker arguments
    println!("cargo:rustc-link-arg=-zstack-size=1048576");
}
