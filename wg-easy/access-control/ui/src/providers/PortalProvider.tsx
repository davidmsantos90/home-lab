import {
  createContext,
  ReactNode,
  useContext,
  useMemo,
  useState,
  type FC,
  type PropsWithChildren,
} from "react";
import { createPortal } from "react-dom";

interface PortalValue {
  isOpen: boolean;
  openPortal: (id: string, content: ReactNode) => void;
  closePortal: (id: string) => void;
}

interface Portal {
  id: string;
  content: ReactNode;
  // root?: HTMLElement;
}

const PortalContext = createContext<PortalValue | undefined>(undefined);

export const usePortalContext = () => {
  const context = useContext(PortalContext);

  if (!context) {
    throw new Error("usePortalContext must be used within a PortalProvider");
  }

  return context;
};

const PortalProvider: FC<PropsWithChildren> = ({ children }) => {
  const [activePortal, setActivePortal] = useState<Portal | null>(null);

  const value = useMemo(
    () => ({
      isOpen: activePortal !== null,
      openPortal: (id: string, content: ReactNode) =>
        setActivePortal({ id, content }),
      closePortal: (id: string) =>
        setActivePortal((current) => (current?.id === id ? null : current)),
    }),
    [activePortal],
  );

  return (
    <PortalContext.Provider value={value}>
      {children}
      {activePortal && createPortal(activePortal.content, document.body)}
    </PortalContext.Provider>
  );
};

export default PortalProvider;
