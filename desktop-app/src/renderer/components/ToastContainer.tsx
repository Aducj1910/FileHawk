import React from 'react';
import { 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Info, 
  X 
} from 'lucide-react';
import { useToast, Toast, ToastType } from '../contexts/ToastContext';

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onDismiss }) => {
  const getToastStyles = (type: ToastType) => {
    switch (type) {
      case 'success':
        return {
          icon: <CheckCircle size={18} className="text-green-400" />,
          bgColor: 'bg-green-50 border-green-200',
          titleColor: 'text-green-900',
          messageColor: 'text-green-700',
          buttonColor: 'text-green-500 hover:text-green-600'
        };
      case 'error':
        return {
          icon: <XCircle size={18} className="text-red-400" />,
          bgColor: 'bg-red-50 border-red-200',
          titleColor: 'text-red-900',
          messageColor: 'text-red-700',
          buttonColor: 'text-red-500 hover:text-red-600'
        };
      case 'warning':
        return {
          icon: <AlertTriangle size={18} className="text-yellow-400" />,
          bgColor: 'bg-yellow-50 border-yellow-200',
          titleColor: 'text-yellow-900',
          messageColor: 'text-yellow-700',
          buttonColor: 'text-yellow-500 hover:text-yellow-600'
        };
      case 'info':
        return {
          icon: <Info size={18} className="text-blue-400" />,
          bgColor: 'bg-blue-50 border-blue-200',
          titleColor: 'text-blue-900',
          messageColor: 'text-blue-700',
          buttonColor: 'text-blue-500 hover:text-blue-600'
        };
    }
  };

  const getToastStylesDark = (type: ToastType) => {
    switch (type) {
      case 'success':
        return {
          icon: <CheckCircle size={18} className="text-green-400" />,
          bgColor: 'bg-green-900/20 border-green-500/30',
          titleColor: 'text-green-100',
          messageColor: 'text-green-200',
          buttonColor: 'text-green-400 hover:text-green-300'
        };
      case 'error':
        return {
          icon: <XCircle size={18} className="text-red-400" />,
          bgColor: 'bg-red-900/20 border-red-500/30',
          titleColor: 'text-red-100',
          messageColor: 'text-red-200',
          buttonColor: 'text-red-400 hover:text-red-300'
        };
      case 'warning':
        return {
          icon: <AlertTriangle size={18} className="text-yellow-400" />,
          bgColor: 'bg-yellow-900/20 border-yellow-500/30',
          titleColor: 'text-yellow-100',
          messageColor: 'text-yellow-200',
          buttonColor: 'text-yellow-400 hover:text-yellow-300'
        };
      case 'info':
        return {
          icon: <Info size={18} className="text-blue-400" />,
          bgColor: 'bg-blue-900/20 border-blue-500/30',
          titleColor: 'text-blue-100',
          messageColor: 'text-blue-200',
          buttonColor: 'text-blue-400 hover:text-blue-300'
        };
    }
  };

  const styles = getToastStylesDark(toast.type); // Using dark theme for FileHawk

  return (
    <div 
      className={`${styles.bgColor} border rounded-lg shadow-lg p-4 mb-3 animate-slide-down transition-all duration-300 ease-out max-w-md w-full`}
      role="alert"
    >
      <div className="flex items-start space-x-3">
        <div className="flex-shrink-0 mt-0.5">
          {styles.icon}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className={`text-sm font-semibold ${styles.titleColor} mb-1`}>
            {toast.title}
          </h4>
          {toast.message && (
            <p className={`text-sm ${styles.messageColor} leading-relaxed`}>
              {toast.message}
            </p>
          )}
          {toast.action && (
            <div className="mt-3">
              <button
                onClick={toast.action.onClick}
                className={`text-sm font-medium ${styles.buttonColor} underline`}
              >
                {toast.action.label}
              </button>
            </div>
          )}
        </div>
        <button
          onClick={() => onDismiss(toast.id)}
          className={`flex-shrink-0 ml-4 p-1 rounded-md ${styles.buttonColor} hover:bg-black/5 transition-colors`}
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

const ToastContainer: React.FC = () => {
  const { toasts, hideToast } = useToast();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col items-end pointer-events-none">
      <div className="flex flex-col space-y-2 pointer-events-auto">
        {toasts.map((toast) => (
          <ToastItem 
            key={toast.id} 
            toast={toast} 
            onDismiss={hideToast}
          />
        ))}
      </div>
    </div>
  );
};

export default ToastContainer;