import React, { useEffect, useState } from "react";
import { api } from "../api/client";
import { CheckIcon, DoctorIcon, WarningIcon } from "./Icons";

interface DoctorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DoctorModal: React.FC<DoctorModalProps> = ({ isOpen, onClose }) => {
  const [checks, setChecks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const runChecks = async () => {
    setLoading(true);
    try {
      const res = await api.runDoctor();
      setChecks(res.checks);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      runChecks();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="doctor-title">
      <div className="modal-dialog">
        <h2 id="doctor-title" className="modal-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <DoctorIcon size={20} /> System Diagnostics
        </h2>

        {loading ? (
          <div style={{ padding: "30px", textAlign: "center", color: "#666" }}>
            Running diagnostics on providers, models, and audio devices...
          </div>
        ) : (
          <div style={{ margin: "16px 0", border: "1.5px solid var(--ink)", borderRadius: "3px", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ background: "var(--paper-deep)", borderBottom: "1.5px solid var(--ink)", textAlign: "left" }}>
                  <th style={{ padding: "8px 12px" }}>Check</th>
                  <th style={{ padding: "8px 12px" }}>Status</th>
                  <th style={{ padding: "8px 12px" }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((c, i) => (
                  <tr key={i} style={{ borderBottom: i < checks.length - 1 ? "1px solid #ddd" : "none", background: i % 2 === 0 ? "#fff" : "var(--paper-card)" }}>
                    <td style={{ padding: "8px 12px", fontWeight: "bold" }}>{c.name}</td>
                    <td style={{ padding: "8px 12px" }}>
                      <span
                        style={{
                          color: c.passed ? "#155724" : "#721c24",
                          fontWeight: "bold",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        {c.passed ? (
                          <>
                            <CheckIcon size={14} /> OK
                          </>
                        ) : (
                          <>
                            <WarningIcon size={14} /> FAILED
                          </>
                        )}
                      </span>
                    </td>
                    <td style={{ padding: "8px 12px", color: "#555", fontFamily: "var(--font-sans)" }}>{c.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={runChecks} disabled={loading}>
            Re-run Checks
          </button>
          <button type="button" className="btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
