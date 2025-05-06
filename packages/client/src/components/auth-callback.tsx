import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { handleAuthCallback } from '../lib/auth';

export const AuthCallback: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // 현재 URL에서 콜백 처리
        const result = await handleAuthCallback(window.location.href);
        
        // 인증 성공 시 메인 페이지로 이동
        navigate('/');
      } catch (error) {
        console.error('Auth callback failed:', error);
        // 에러 발생 시 에러 페이지로 이동
        navigate('/error');
      }
    };

    handleCallback();
  }, [navigate]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-4">Authenticating...</h2>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
      </div>
    </div>
  );
};
