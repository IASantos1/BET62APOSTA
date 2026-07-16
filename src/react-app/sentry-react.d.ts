declare module '@sentry/react' {
  import type { ComponentType, ReactNode } from 'react';

  export type SentryInitOptions = Record<string, unknown>;

  export interface ErrorBoundaryProps {
    children?: ReactNode;
    fallback?: ReactNode;
  }

  export function init(options?: SentryInitOptions): void;
  export const ErrorBoundary: ComponentType<ErrorBoundaryProps>;
}
