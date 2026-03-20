import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Eye, EyeOff, ArrowRight, Loader2 } from "lucide-react";
import { SiApple, SiGoogle } from "react-icons/si";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: any) => void;
          prompt: () => void;
          cancel: () => void;
        };
      };
    };
  }
}

export default function Welcome() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const googleScriptLoaded = useRef(false);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

  useEffect(() => {
    if (!googleClientId || googleScriptLoaded.current) return;
    googleScriptLoaded.current = true;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    document.head.appendChild(script);
  }, [googleClientId]);

  const authMutation = useMutation({
    mutationFn: async (data: { email: string; password: string; isLogin: boolean }) => {
      const endpoint = data.isLogin ? "/api/auth/login" : "/api/auth/register";
      const res = await apiRequest("POST", endpoint, {
        username: data.email,
        password: data.password,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/auth/me"], data);
    },
    onError: (error: Error) => {
      toast({
        title: isLogin ? "Login failed" : "Registration failed",
        description: error.message || "Please check your credentials and try again.",
        variant: "destructive",
      });
    },
  });

  const googleMutation = useMutation({
    mutationFn: async (credential: string) => {
      const res = await apiRequest("POST", "/api/auth/google", { credential });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/auth/me"], data);
    },
    onError: (error: Error) => {
      setGoogleLoading(false);
      toast({
        title: "Google Sign-In failed",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      toast({ title: "Missing fields", description: "Please fill in all fields.", variant: "destructive" });
      return;
    }

    if (!isLogin && password !== confirmPassword) {
      toast({ title: "Passwords don't match", description: "Please make sure your passwords match.", variant: "destructive" });
      return;
    }

    if (!isLogin && password.length < 6) {
      toast({ title: "Password too short", description: "Password must be at least 6 characters.", variant: "destructive" });
      return;
    }

    authMutation.mutate({ email, password, isLogin });
  };

  const handleGoogleLogin = () => {
    if (!googleClientId) {
      toast({
        title: "Google Sign-In not available",
        description: "Please use email and password to sign in.",
        variant: "destructive",
      });
      return;
    }

    if (!window.google?.accounts?.id) {
      toast({
        title: "Google Sign-In loading",
        description: "Please try again in a moment.",
      });
      return;
    }

    setGoogleLoading(true);

    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: (response: { credential: string }) => {
        googleMutation.mutate(response.credential);
      },
      cancel_on_tap_outside: true,
    });

    window.google.accounts.id.prompt();
    setTimeout(() => setGoogleLoading(false), 3000);
  };

  const handleAppleLogin = () => {
    toast({
      title: "Apple Sign-In",
      description: "Available in the native iOS app. Use email/password to sign in on web.",
    });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary/20">
            <span className="text-primary-foreground text-xl font-bold">D</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-1">DBrief</h1>
          <p className="text-sm text-muted-foreground">Your daily debrief. Track, reflect, grow.</p>
        </div>

        <Card className="shadow-lg border-border/50">
          <CardContent className="p-5">
            <div className="flex mb-5 bg-muted rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setIsLogin(true)}
                className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
                  isLogin
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setIsLogin(false)}
                className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
                  !isLogin
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Create Account
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <Label htmlFor="email" className="text-xs">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 h-9"
                />
              </div>

              <div>
                <Label htmlFor="password" className="text-xs">Password</Label>
                <div className="relative mt-1">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-9 h-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {!isLogin && (
                <div>
                  <Label htmlFor="confirmPassword" className="text-xs">Confirm Password</Label>
                  <Input
                    id="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    placeholder="Confirm your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="mt-1 h-9"
                  />
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-9 text-sm"
                disabled={authMutation.isPending}
              >
                {authMutation.isPending
                  ? "Please wait..."
                  : isLogin
                  ? "Sign In"
                  : "Create Account"}
                {!authMutation.isPending && <ArrowRight className="ml-1.5 h-3.5 w-3.5" />}
              </Button>
            </form>

            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-card px-3 text-muted-foreground">or</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={handleGoogleLogin}
                disabled={googleLoading || googleMutation.isPending}
                className="w-full h-9 text-xs"
              >
                {(googleLoading || googleMutation.isPending)
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <SiGoogle className="h-3.5 w-3.5 mr-1.5" />}
                {!googleLoading && !googleMutation.isPending && "Google"}
              </Button>
              <Button
                variant="outline"
                onClick={handleAppleLogin}
                className="w-full h-9 text-xs"
              >
                <SiApple className="h-3.5 w-3.5 mr-1.5" />
                Apple
              </Button>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground/60 mt-5">
          By continuing, you agree to our Terms and Privacy Policy
        </p>
      </div>
    </div>
  );
}
