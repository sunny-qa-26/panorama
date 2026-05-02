'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export function DrawerContainer({ children, title }: { children: React.ReactNode; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!open) {
      // Navigate back, but fall back to home when the user landed here from a
      // fresh tab (no in-app history). Otherwise router.back() drops them off
      // the panorama app entirely.
      if (typeof window !== 'undefined' && window.history.length > 1) {
        router.back();
      } else {
        router.push('/');
      }
    }
  }, [open, router]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen} modal>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed right-0 top-0 h-full w-[460px] max-w-[90vw] bg-bg-1 border-l border-bg-3 shadow-2xl z-50 overflow-y-auto data-[state=open]:animate-in data-[state=open]:slide-in-from-right"
          aria-describedby={undefined}
        >
          <div className="sticky top-0 bg-bg-1 border-b border-bg-3 px-4 py-3 flex items-center gap-2 z-10">
            <Dialog.Title className="text-sm font-semibold flex-1 truncate">{title}</Dialog.Title>
            <Dialog.Close className="text-text-3 hover:text-text px-2" aria-label="close">✕</Dialog.Close>
          </div>
          <div className="p-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
