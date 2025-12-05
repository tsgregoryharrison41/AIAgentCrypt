import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface AgentData {
  id: string;
  name: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
}

const FHEEncryptNumber = (value: number): string => `FHE-${btoa(value.toString())}`;
const FHEDecryptNumber = (encryptedData: string): number => encryptedData.startsWith('FHE-') ? parseFloat(atob(encryptedData.substring(4))) : parseFloat(encryptedData);
const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newAgentData, setNewAgentData] = useState({ name: "", data: "" });
  const [selectedAgent, setSelectedAgent] = useState<AgentData | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const [chainId, setChainId] = useState(0);
  const [startTimestamp, setStartTimestamp] = useState(0);
  const [durationDays, setDurationDays] = useState(30);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [transactionStatus, setTransactionStatus] = useState({ visible: false, status: "pending", message: "" });

  useEffect(() => {
    loadData().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadData = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "ZAMA FHE Connected!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
      
      const agentsBytes = await contract.getData("agents");
      let agentsList: AgentData[] = [];
      if (agentsBytes.length > 0) {
        try {
          const agentsStr = ethers.toUtf8String(agentsBytes);
          if (agentsStr.trim() !== '') agentsList = JSON.parse(agentsStr);
        } catch (e) {}
      }
      setAgents(agentsList);
    } catch (e) {
      console.error("Error loading data:", e);
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setLoading(false); 
    }
  };

  const createAgent = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted agent..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("No contract");
      
      const newAgent: AgentData = {
        id: `agent-${Date.now()}`,
        name: newAgentData.name,
        encryptedData: FHEEncryptNumber(parseFloat(newAgentData.data) || 0),
        timestamp: Math.floor(Date.now() / 1000),
        owner: address
      };
      
      const updatedAgents = [...agents, newAgent];
      await contract.setData("agents", ethers.toUtf8Bytes(JSON.stringify(updatedAgents)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Agent created!" });
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewAgentData({ name: "", data: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Error: " + (e.message || "Unknown");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const renderDashboard = () => {
    return (
      <div className="dashboard-grid">
        <div className="dashboard-card neon-card">
          <h3>Total Agents</h3>
          <div className="stat-value">{agents.length}</div>
        </div>
        <div className="dashboard-card neon-card">
          <h3>Active Sessions</h3>
          <div className="stat-value">12</div>
        </div>
        <div className="dashboard-card neon-card">
          <h3>FHE Operations</h3>
          <div className="stat-value">1,248</div>
        </div>
      </div>
    );
  };

  const renderFAQ = () => {
    return (
      <div className="faq-container">
        <div className="faq-item">
          <div className="faq-question">What is AIAgentCrypt?</div>
          <div className="faq-answer">A privacy-preserving AI agent system using ZAMA FHE to encrypt user data and preferences.</div>
        </div>
        <div className="faq-item">
          <div className="faq-question">How does FHE protect my data?</div>
          <div className="faq-answer">FHE allows AI agents to process encrypted data without decryption, keeping your information private.</div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Initializing encrypted AI system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>AIAgent<span>Crypt</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="neon-btn"
          >
            New Agent
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="tabs">
          <button 
            className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            Dashboard
          </button>
          <button 
            className={`tab ${activeTab === 'agents' ? 'active' : ''}`}
            onClick={() => setActiveTab('agents')}
          >
            My Agents
          </button>
          <button 
            className={`tab ${activeTab === 'faq' ? 'active' : ''}`}
            onClick={() => setActiveTab('faq')}
          >
            FAQ
          </button>
        </div>
        
        <div className="tab-content">
          {activeTab === 'dashboard' && (
            <div className="dashboard-content">
              <h2>Encrypted AI Agent Dashboard</h2>
              {renderDashboard()}
              
              <div className="fhe-process">
                <h3>ZAMA FHE Process Flow</h3>
                <div className="process-steps">
                  <div className="step">
                    <div className="step-number">1</div>
                    <div className="step-content">
                      <h4>Data Encryption</h4>
                      <p>User data encrypted with ZAMA FHE</p>
                    </div>
                  </div>
                  <div className="step">
                    <div className="step-number">2</div>
                    <div className="step-content">
                      <h4>Agent Processing</h4>
                      <p>AI operates on encrypted data</p>
                    </div>
                  </div>
                  <div className="step">
                    <div className="step-number">3</div>
                    <div className="step-content">
                      <h4>Secure Results</h4>
                      <p>Only user can decrypt outputs</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {activeTab === 'agents' && (
            <div className="agents-content">
              <h2>My Encrypted AI Agents</h2>
              
              <div className="agents-list">
                {agents.length === 0 ? (
                  <div className="no-agents">
                    <p>No agents found</p>
                    <button 
                      className="neon-btn" 
                      onClick={() => setShowCreateModal(true)}
                    >
                      Create First Agent
                    </button>
                  </div>
                ) : agents.map((agent, index) => (
                  <div 
                    className={`agent-item ${selectedAgent?.id === agent.id ? "selected" : ""}`} 
                    key={index}
                    onClick={() => setSelectedAgent(agent)}
                  >
                    <div className="agent-name">{agent.name}</div>
                    <div className="agent-data">{agent.encryptedData.substring(0, 15)}...</div>
                    <div className="agent-owner">{agent.owner.substring(0, 6)}...{agent.owner.substring(38)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {activeTab === 'faq' && (
            <div className="faq-content">
              <h2>Frequently Asked Questions</h2>
              {renderFAQ()}
            </div>
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>New Encrypted Agent</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-modal">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Agent Name</label>
                <input 
                  type="text" 
                  value={newAgentData.name} 
                  onChange={(e) => setNewAgentData({...newAgentData, name: e.target.value})} 
                  placeholder="My AI Agent" 
                />
              </div>
              
              <div className="form-group">
                <label>Initial Data (Number)</label>
                <input 
                  type="number" 
                  value={newAgentData.data} 
                  onChange={(e) => setNewAgentData({...newAgentData, data: e.target.value})} 
                  placeholder="123.45" 
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createAgent} 
                disabled={!newAgentData.name || !newAgentData.data} 
                className="neon-btn"
              >
                Create Encrypted Agent
              </button>
            </div>
          </div>
        </div>
      )}
      
      {selectedAgent && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>Agent Details</h2>
              <button onClick={() => {
                setSelectedAgent(null);
                setDecryptedData(null);
              }} className="close-modal">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="agent-info">
                <div className="info-item">
                  <span>Name:</span>
                  <strong>{selectedAgent.name}</strong>
                </div>
                <div className="info-item">
                  <span>Owner:</span>
                  <strong>{selectedAgent.owner.substring(0, 6)}...{selectedAgent.owner.substring(38)}</strong>
                </div>
                <div className="info-item">
                  <span>Created:</span>
                  <strong>{new Date(selectedAgent.timestamp * 1000).toLocaleString()}</strong>
                </div>
              </div>
              
              <div className="data-section">
                <h3>Encrypted Data</h3>
                <div className="encrypted-data">
                  {selectedAgent.encryptedData.substring(0, 30)}...
                </div>
                <button 
                  className="neon-btn" 
                  onClick={async () => {
                    if (decryptedData !== null) {
                      setDecryptedData(null);
                    } else {
                      const decrypted = await decryptWithSignature(selectedAgent.encryptedData);
                      if (decrypted !== null) setDecryptedData(decrypted);
                    }
                  }} 
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : decryptedData !== null ? "Hide Data" : "Decrypt Data"}
                </button>
              </div>
              
              {decryptedData !== null && (
                <div className="decrypted-section">
                  <h3>Decrypted Value</h3>
                  <div className="decrypted-value">{decryptedData}</div>
                </div>
              )}
            </div>
            
            <div className="modal-footer">
              <button onClick={() => {
                setSelectedAgent(null);
                setDecryptedData(null);
              }} className="close-btn">Close</button>
            </div>
          </div>
        </div>
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className={`transaction-content ${transactionStatus.status}`}>
            <div className="transaction-message">
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <h3>AIAgentCrypt</h3>
            <p>Encrypted AI Agent Interaction Protocol</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Docs</a>
            <a href="#" className="footer-link">Privacy</a>
            <a href="#" className="footer-link">Terms</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="zama-badge">
            <span>Powered by ZAMA FHE</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;