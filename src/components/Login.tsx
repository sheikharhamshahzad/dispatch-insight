import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { LogIn, User, Lock } from "lucide-react";

interface Client {
  id: string;
  username: string;
}

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Demo/development bypass - skip database check
      if (username === "demo" && password === "demo") {
        // Save a minimal session and navigate
        localStorage.setItem(
          "di_client_session",
          JSON.stringify({ id: "demo", username: "demo", ts: Date.now() })
        );
        navigate("/dashboard", { replace: true });
        return;
      }

      // Simple credential match against clients table.
      // Note: For production, store hashed passwords and verify server-side.
      const { data, error } = await supabase
        .from("clients")
        .select("id, username")
        .eq("username", username.trim())
        .eq("password", password) // plaintext match per current schema
        .single<Client>();

      if (error || !data) {
        setError("Invalid username or password. Try demo/demo for testing.");
        return;
      }

      // Save a minimal session and navigate
      localStorage.setItem(
        "di_client_session",
        JSON.stringify({ id: data.id, username: data.username, ts: Date.now() })
      );
      navigate("/dashboard", { replace: true });
    } catch {
      setError("Something went wrong. Try demo/demo for testing.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md overflow-hidden bg-white border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
        <CardHeader className="bg-gray-50 border-b">
          <CardTitle className="text-xl">Sign in</CardTitle>
          <CardDescription>Access your dashboard</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Username</label>
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-gray-500" />
                <Input
                  type="text"
                  placeholder="Enter username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Password</label>
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-gray-500" />
                <Input
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md p-2">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={submitting || !username || !password}
            >
              {submitting ? "Signing in..." : (
                <span className="inline-flex items-center gap-2">
                  <LogIn className="h-4 w-4" /> Sign in
                </span>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}