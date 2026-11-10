Pod::Spec.new do |s|
  s.name           = 'SynergiNative'
  s.version        = '1.0.0'
  s.summary        = 'Calls (CallKit, PushKit) and notifications for the SynergiFund iPhone app'
  s.description    = 'Calls (CallKit, PushKit) and notifications for the SynergiFund iPhone app'
  s.license        = 'UNLICENSED'
  s.author         = 'SynergiFund'
  s.homepage       = 'https://admin.synergifund.com'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CallKit', 'PushKit', 'UserNotifications', 'AVFAudio'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
