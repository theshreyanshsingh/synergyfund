const { withAppBuildGradle } = require("expo/config-plugins")

// Release builds made on this computer are signed with SynergiFund's Google Play upload key when it is set up in
// ~/secrets/synergifund-upload.properties (storeFile, storePassword, keyAlias, keyPassword), kept outside the project.
// Without it, release builds use the debug key (fine for testing, not accepted by Google Play).
const MARK = "// SynergiFund upload key"

module.exports = function withUploadSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    let gradle = mod.modResults.contents
    if (gradle.includes(MARK)) return mod
    gradle = gradle.replace(
      /\nandroid \{/,
      `\n${MARK}
def synergifundUpload = new Properties()
def synergifundUploadFile = new File(System.getProperty("user.home"), "secrets/synergifund-upload.properties")
if (synergifundUploadFile.exists()) synergifundUploadFile.withInputStream { synergifundUpload.load(it) }

android {`,
    )
    gradle = gradle.replace(
      /signingConfigs \{\n/,
      `signingConfigs {
        upload {
            if (synergifundUploadFile.exists()) {
                storeFile file(synergifundUpload['storeFile'])
                storePassword synergifundUpload['storePassword']
                keyAlias synergifundUpload['keyAlias']
                keyPassword synergifundUpload['keyPassword']
            }
        }
`,
    )
    gradle = gradle.replace(
      /(release \{[\s\S]*?)signingConfig signingConfigs\.debug/,
      "$1signingConfig synergifundUploadFile.exists() ? signingConfigs.upload : signingConfigs.debug",
    )
    mod.modResults.contents = gradle
    return mod
  })
}
