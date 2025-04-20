import { useState, useEffect } from 'react';
import { initializeWasm } from '../wasm/wasmBridge';

/**
 * React hook for initializing WebAssembly modules in @threegis/core.
 * 
 * @returns {Object} An object containing the initialization state and any errors
 */
export function useWasm() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;

    const initialize = async () => {
      try {
        await initializeWasm();
        
        if (isMounted) {
          setIsInitialized(true);
          setIsLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsLoading(false);
        }
      }
    };

    initialize();

    return () => {
      isMounted = false;
    };
  }, []);

  return {
    isInitialized,
    isLoading,
    error
  };
}
