{
  description = "Pathfinder — Arma 3 server with an admin page, for the homelab";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    rust-overlay.url = "github:oxalica/rust-overlay";
    rust-overlay.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nixpkgs, rust-overlay }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs {
        inherit system;
        overlays = [ rust-overlay.overlays.default ];
      };
      rust = pkgs.rust-bin.stable.latest.default.override {
        extensions = [ "rust-src" "clippy" "rustfmt" ];
      };
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        packages = [
          rust
          pkgs.nodejs_22
        ];

        RUST_BACKTRACE = "1";
      };
    };
}
