release {
  provider                = "github"
  url                     = "https://github.com/openkcm/platform-mesh-microfrontend/releases"
  changelog               = "CHANGELOG.md"
  tag_prefix              = "v"
  release_name_template   = "Release {{.Version}}"
  assets = [
    "*"
  ]
}
