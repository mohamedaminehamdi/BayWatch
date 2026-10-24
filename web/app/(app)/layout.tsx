import { auth } from '@clerk/nextjs/server';
import { AppNav } from '@/components/app/app-nav';
import { AppStateProvider } from '@/components/app/app-state';
import { isOperator } from '@/lib/server';

// Everything in the app needs a signed-in driver; signed-out visitors are sent to sign-in
export default async function AppLayout({ children }: LayoutProps<'/'>) {
  await auth.protect();
  return (
    <AppStateProvider>
      <div className="flex min-h-dvh flex-col">
        <AppNav operator={await isOperator()} />
        <main id="main" className="flex flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
          {children}
        </main>
      </div>
    </AppStateProvider>
  );
}
