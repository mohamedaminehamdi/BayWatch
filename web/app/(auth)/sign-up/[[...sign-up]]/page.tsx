import { SignUp } from '@clerk/nextjs';
import type { Metadata } from 'next';
import { clerkCard } from '@/components/ui/clerk-card';

export const metadata: Metadata = { title: 'Create your account' };

// New drivers land on the onboarding step that adds their car
export default function SignUpPage() {
  return <SignUp fallbackRedirectUrl="/welcome" signInFallbackRedirectUrl="/explore" appearance={clerkCard} />;
}
