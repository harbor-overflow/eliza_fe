import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import { useWallet } from '@/contexts/wallet-context';

const Callback: React.FC = () => {
  const { processJwt } = useWallet();
  const [isProcessing, setIsProcessing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      // Extract id_token parameter from URL
      const params = new URLSearchParams(window.location.search);
      const idToken = params.get('id_token');
      
      if (idToken) {
        try {
          // Process JWT
          await processJwt(idToken);
          setIsProcessing(false);
        } catch (error) {
          console.error('JWT processing error:', error);
          setError('An error occurred while processing the authentication token.');
          setIsProcessing(false);
        }
      } else {
        setError('Authentication token not found.');
        setIsProcessing(false);
      }
    };

    handleCallback();
  }, [processJwt]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative">
          <strong className="font-bold">Error:</strong>
          <span className="block sm:inline"> {error}</span>
        </div>
        <button
          className="mt-4 bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          onClick={() => window.location.href = '/'}
        >
          Return to Home
        </button>
      </div>
    );
  }

  if (isProcessing) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-700"></div>
        <p className="mt-4 text-xl font-semibold">Processing authentication...</p>
      </div>
    );
  }

  // Redirect to homepage when complete
  return <Navigate to="/" />;
};

export default Callback; 