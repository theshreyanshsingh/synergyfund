import { Platform } from "react-native"
import { requireOptionalNativeModule } from "expo"

// Native calls and notifications: Android (Firebase, its own call screen) and iPhone (Apple push, CallKit). Missing in
// Expo Go: callers check for null.
const SynergiNative = Platform.OS === "android" || Platform.OS === "ios" ? requireOptionalNativeModule("SynergiNative") : null

export default SynergiNative
