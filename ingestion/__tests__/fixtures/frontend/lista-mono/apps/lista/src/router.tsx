// @ts-nocheck — fixture
import { createBrowserRouter } from 'react-router-dom';

export const router = createBrowserRouter([
  {
    path: '/',
    children: [
      {
        index: true,
        lazy: async () => {
          const { Home } = await import('@/modules/home/page');
          return { Component: Home };
        },
      },
      {
        path: 'dashboard',
        lazy: async () => {
          const { DashboardPage } = await import('@/modules/dashboard/page');
          return { Component: DashboardPage };
        },
      },
    ],
  },
  {
    path: 'liquid-staking/BNB',
    lazy: async () => {
      const { BnbStaking } = await import('@/modules/staking/bnb/page');
      return { Component: BnbStaking };
    },
  },
]);
