import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { CheckIcon, CloseIcon, DoctorIcon, WarningIcon } from "./Icons";
import { useDialog } from "./useDialog";

interface DoctorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface DoctorCheck {
  name: string;
  passed: boolean;
  details?: string;
}

export const DoctorModal: React.FC<DoctorModalProps> = ({ isOpen, onClose }) => {
  const [checks, setChecks] = useState<DoctorCheck[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const dialogRef = useDialog(isOpen, onClose);

  const runChecks = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setChecks([]);
    try {
      const result = await api.runDoctor();
      if (requestId === requestIdRef.current) setChecks(result.checks as DoctorCheck[]);
    } catch (runError) {
      if (requestId === requestIdRef.current) {
        setError(runError instanceof Error ? runError.message : "Diagnostics could not be completed.");
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void runChecks();
    else requestIdRef.current += 1;
  }, [isOpen, runChecks]);

  if (!isOpen) return null;
  const passing = checks.filter((check) => check.passed).length;

  return (
    <div className="modal-overlay">
      <div
        ref={dialogRef}
        className="modal-dialog doctor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="doctor-title"
        tabIndex={-1}
      >
        <div className="modal-header">
          <div className="modal-heading-with-icon">
            <span className="modal-heading-icon"><DoctorIcon size={19} /></span>
            <div>
              <span className="section-kicker">Backstage check</span>
              <h2 id="doctor-title" className="modal-title">System Diagnostics</h2>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close diagnostics">
            <CloseIcon size={15} />
          </button>
        </div>

        {loading ? (
          <div className="diagnostic-loading" role="status">
            <span className="spinner-indicator" aria-hidden="true" />
            <strong>Checking the backstage systems</strong>
            <span>Providers, models, local assets, and audio output</span>
          </div>
        ) : error ? (
          <div className="form-alert error" role="alert">
            <WarningIcon size={17} /> {error}
          </div>
        ) : (
          <>
            <div className={`diagnostic-summary ${passing === checks.length ? "all-clear" : "needs-attention"}`}>
              <strong>{passing} of {checks.length} checks passed</strong>
              <span>{passing === checks.length ? "Everything is ready for a performance." : "Some systems need attention before rendering."}</span>
            </div>
            <div className="diagnostic-table-wrap">
              <table>
                <thead>
                  <tr><th>Check</th><th>Status</th><th>Details</th></tr>
                </thead>
                <tbody>
                  {checks.map((check) => (
                    <tr key={check.name}>
                      <td><strong>{check.name}</strong></td>
                      <td>
                        <span className={`check-status ${check.passed ? "passed" : "failed"}`}>
                          {check.passed ? <CheckIcon size={14} /> : <WarningIcon size={14} />}
                          {check.passed ? "Ready" : "Failed"}
                        </span>
                      </td>
                      <td>{check.details || "No details reported"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={() => void runChecks()} disabled={loading}>Run Again</button>
          <button type="button" className="btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};
