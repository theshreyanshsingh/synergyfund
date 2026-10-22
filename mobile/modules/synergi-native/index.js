import { Platform } from "react-native"
import { requireOptionalNativeModule } from "expo"

// Native calls and notifications on Android. Missing in Expo Go and on iPhone for now: callers check for null.
const SynergiNative = Platform.OS === "android" ? requireOptionalNativeModule("SynergiNative") : null

export default SynergiNative
