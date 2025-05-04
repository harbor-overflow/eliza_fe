import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import { useWallet } from '@/contexts/wallet-context';

const Callback: React.FC = () => {
  const { processJwt } = useWallet();
  const [isProcessing, setIsProcessing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      // URL에서 id_token 파라미터 추출
      const params = new URLSearchParams(window.location.search);
      const idToken = params.get('id_token');
      
      if (idToken) {
        try {
          // JWT 처리
          await processJwt(idToken);
          setIsProcessing(false);
        } catch (error) {
          console.error('JWT 처리 오류:', error);
          setError('JWT 처리 중 오류가 발생했습니다.');
          setIsProcessing(false);
        }
      } else {
        setError('인증 토큰을 찾을 수 없습니다.');
        setIsProcessing(false);
      }
    };

    handleCallback();
  }, [processJwt]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative">
          <strong className="font-bold">오류:</strong>
          <span className="block sm:inline"> {error}</span>
        </div>
        <button
          className="mt-4 bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          onClick={() => window.location.href = '/'}
        >
          홈으로 돌아가기
        </button>
      </div>
    );
  }

  if (isProcessing) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-700"></div>
        <p className="mt-4 text-xl font-semibold">인증 처리 중...</p>
      </div>
    );
  }

  // 처리가 완료되면 홈페이지로 리다이렉트
  return <Navigate to="/" />;
};

export default Callback; 