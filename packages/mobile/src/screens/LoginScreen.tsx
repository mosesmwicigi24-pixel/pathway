// Sign-in (spec §5.3). Federated providers only; the authorization-code exchange
// happens server-side and we store the returned tokens in the secure enclave.
import { useState, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { NuruApi, setAccessToken } from "../api/client";
import { useNavigation } from "../navigation/RootNavigator";

const PROVIDERS = ["kingschat", "google", "apple"] as const;

export function LoginScreen(): ReactElement {
  const nav = useNavigation();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(provider: (typeof PROVIDERS)[number]): Promise<void> {
    setBusy(provider);
    setError(null);
    try {
      // The provider SDK yields an authorization code; exchanged server-side.
      const code = await obtainAuthorizationCode(provider);
      const tokens = await NuruApi.oauth(provider, code);
      setAccessToken(tokens.access_token);
      nav.navigate({ name: "Home" });
    } catch {
      setError("Sign-in failed. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 24, fontWeight: "600", marginBottom: 16 }}>Nuru Place · Pathway</Text>
      {PROVIDERS.map((p) => (
        <Pressable
          key={p}
          accessibilityRole="button"
          disabled={busy !== null}
          onPress={() => void signIn(p)}
          style={{ padding: 14, borderRadius: 8, backgroundColor: "#1f2937" }}
        >
          <Text style={{ color: "white", textAlign: "center" }}>
            {busy === p ? "Connecting…" : `Continue with ${p}`}
          </Text>
        </Pressable>
      ))}
      {error ? <Text style={{ color: "#b91c1c" }}>{error}</Text> : null}
    </View>
  );
}

// Placeholder for the provider SDK handshake (KingsChat/Google/Apple), wired per
// platform once the native projects are generated.
function obtainAuthorizationCode(_provider: string): Promise<string> {
  return Promise.reject(new Error("provider SDK not wired in this build"));
}
