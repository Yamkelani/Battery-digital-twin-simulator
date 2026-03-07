import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.batterysim.digitaltwin',
  appName: 'Battery Digital Twin',
  webDir: 'dist',
  
  // Server config — allows the app to connect to your hosted backend
  server: {
    // For development, you can point to your local machine's IP:
    // url: 'http://192.168.1.100:5173',
    // cleartext: true,
    
    // For production, the app loads from the bundled dist/ files
    androidScheme: 'https',
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#0f172a',
      showSpinner: true,
      spinnerColor: '#22c55e',
      androidSpinnerStyle: 'small',
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',       // light text on dark background
      backgroundColor: '#0f172a',
    },
  },

  // iOS-specific config
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
    scheme: 'Battery DT',
  },

  // Android-specific config
  android: {
    backgroundColor: '#0f172a',
    allowMixedContent: true,  // needed if backend is HTTP during dev
  },
};

export default config;
