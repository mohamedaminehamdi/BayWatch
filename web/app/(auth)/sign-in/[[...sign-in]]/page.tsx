import { SignIn } from '@clerk/nextjs';
import type { Metadata } from 'next';
import { clerkCard } from '@/components/ui/clerk-card';

export const metadata: Metadata = { title: 'Sign in' };

export default function SignInPage() {
  return <SignIn fallbackRedirectUrl="/explore" signUpFallbackRedirectUrl="/welcome" appearance={clerkCard} />;
}
