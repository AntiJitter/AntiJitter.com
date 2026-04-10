import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.antijitter.app",
  appName: "AntíJitter",
  webDir: "dist",
  // In production point to your VPS — in dev use the Vite dev server
  server: {
    // Uncomment for live reload during Android development:
    // url: "http://YOUR_LOCAL_IP:3000",
    // cleartext: true,
  },
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_stat_antijitter",
      iconColor: "#00c8d7",
      sound: "beep.wav",
    },
    // WireGuard VPN tunnel is managed by a native Android VpnService
    // See android/app/src/main/.../WireGuardVpnService.kt
  },
};

export default config;
