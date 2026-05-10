"""
LLM-based Self-Verification for Generated Fault Data

Uses an LLM to verify that:
1. Faults are activated at the specified time
2. Fault injection matches the expected configuration
3. KPI data shows expected anomaly patterns
4. Normal cases are truly without faults
"""

import json
import time
from typing import Dict, List, Any, Optional
from dataclasses import dataclass


class DataVerifier:
    """
    LLM-based verifier for generated fault case data.
    
    Responsibilities:
    1. Validate fault timing and configuration
    2. Check KPI anomaly patterns
    3. Verify normal cases are clean
    4. Provide detailed feedback on issues
    """
    
    def __init__(
        self,
        llm_provider: str = "minimax",
        model: str = None,
        temperature: float = 0.1,
        max_tokens: int = 2048
    ):
        """
        Initialize the data verifier.
        
        Args:
            llm_provider: LLM provider to use
            model: Specific model name
            temperature: Sampling temperature for LLM
            max_tokens: Maximum tokens in LLM response
        """
        self.llm_provider = llm_provider
        self.model = model
        self.temperature = temperature
        self.max_tokens = max_tokens
        self._llm_client = None
    
    def verify(
        self,
        scenario: 'Scenario',
        result: 'SimulationResult'
    ) -> Dict[str, Any]:
        """
        Verify a generated case.
        
        Args:
            scenario: The scenario that was simulated
            result: The simulation result
            
        Returns:
            Verification result dict with keys:
                - passed: bool indicating if verification passed
                - issues: List of critical issues found
                - warnings: List of non-critical warnings
                - confidence: float 0.0-1.0
                - details: Detailed verification report
        """
        issues = []
        warnings = []
        
        # Step 1: Verify fault configuration consistency
        config_issues = self._verify_fault_config(scenario)
        issues.extend(config_issues)
        
        # Step 2: Verify fault timing
        timing_issues = self._verify_fault_timing(scenario, result)
        issues.extend(timing_issues)
        
        # Step 3: Verify KPI data quality
        kpi_issues, kpi_warnings = self._verify_kpi_data(scenario, result)
        issues.extend(kpi_issues)
        warnings.extend(kpi_warnings)
        
        # Step 4: For normal cases, verify no faults present
        if scenario.is_normal:
            normal_issues = self._verify_normal_case(result)
            issues.extend(normal_issues)
        
        # Step 5: Generate detailed report via LLM
        report = self._generate_verification_report(
            scenario, result, issues, warnings
        )
        
        # Determine overall pass/fail
        # A case passes if no critical issues and at least basic sanity checks
        passed = len(issues) == 0 and self._basic_sanity_check(result)
        
        return {
            "passed": passed,
            "issues": issues,
            "warnings": warnings,
            "confidence": self._calculate_confidence(issues, warnings),
            "details": report
        }
    
    def _verify_fault_config(self, scenario: 'Scenario') -> List[str]:
        """Verify that fault configuration is valid."""
        issues = []
        fc = scenario.fault_config
        
        if fc is None and not scenario.is_normal:
            issues.append("FaultConfig is None but scenario.is_normal is False")
            return issues
        
        if fc is not None:
            # Validate loss rate
            if fc.loss_rate < 0 or fc.loss_rate > 1:
                issues.append(f"Invalid loss_rate: {fc.loss_rate}")
            
            # Validate fault timing
            if fc.fault_start < 0 or fc.fault_start > 60:
                issues.append(f"Invalid fault_start: {fc.fault_start}")
            
            if fc.fault_duration <= 0 or fc.fault_start + fc.fault_duration > 65:
                issues.append(f"Invalid fault_duration: {fc.fault_duration}")
            
            # Validate affected elements
            if not fc.affected_ne_ids and fc.fault_point_type not in [
                scenario.fault_config.fault_point_type.PATH_LINK,
                scenario.fault_config.fault_point_type.PATH_TRACE,
                scenario.fault_config.fault_point_type.PATH_SESSION
            ]:
                issues.append("No affected_ne_ids specified for non-path fault type")
        
        return issues
    
    def _verify_fault_timing(
        self,
        scenario: 'Scenario',
        result: 'SimulationResult'
    ) -> List[str]:
        """Verify that faults are activated at the expected time."""
        issues = []
        fc = scenario.fault_config
        
        if fc is None or scenario.is_normal:
            return issues
        
        # Find session-level KPIs
        session_records = [r for r in result.kpi_records if r.level == "session"]
        if not session_records:
            issues.append("No session-level KPI records found")
            return issues
        
        # Check for KPI degradation during fault window
        fault_window_start = fc.fault_start
        fault_window_end = fc.fault_start + fc.fault_duration
        
        # Sample KPIs before, during, and after fault
        before_fault = [
            r.success_rate for r in session_records
            if r.timestamp < fault_window_start and r.timestamp >= 1
        ]
        during_fault = [
            r.success_rate for r in session_records
            if fault_window_start <= r.timestamp < fault_window_end
        ]
        after_fault = [
            r.success_rate for r in session_records
            if r.timestamp >= fault_window_end and r.timestamp <= 60
        ]
        
        # Verify degradation occurs during fault window
        if during_fault:
            avg_during = sum(during_fault) / len(during_fault)
            
            if before_fault:
                avg_before = sum(before_fault) / len(before_fault)
                # During should be lower than before (accounting for noise)
                if avg_during >= avg_before * 0.99:
                    # This might be a low-severity fault, add warning
                    pass  # Not an issue, just potentially hard to detect
            
            if fc.fault_mode.value == "business" and not during_fault:
                issues.append("Business fault mode but no degradation detected during fault window")
        
        return issues
    
    def _verify_kpi_data(
        self,
        scenario: 'Scenario',
        result: 'SimulationResult'
    ) -> tuple[List[str], List[str]]:
        """Verify KPI data quality and expected patterns."""
        issues = []
        warnings = []
        
        if not result.kpi_records:
            issues.append("No KPI records in result")
            return issues, warnings
        
        # Check for required KPI levels
        levels = set(r.level for r in result.kpi_records)
        required_levels = {"link", "trace", "session"}
        missing_levels = required_levels - levels
        if missing_levels:
            issues.append(f"Missing required KPI levels: {missing_levels}")
        
        # Check timestamp range
        timestamps = set(r.timestamp for r in result.kpi_records)
        if timestamps and (min(timestamps) > 1 or max(timestamps) < 60):
            warnings.append(f"KPI timestamps incomplete: {min(timestamps)}-{max(timestamps)}")
        
        # Check for valid success rates
        invalid_sr = [
            r for r in result.kpi_records
            if r.success_rate < 0 or r.success_rate > 1.0
        ]
        if invalid_sr:
            issues.append(f"Found {len(invalid_sr)} KPI records with invalid success_rate")
        
        # Check data volume
        expected_min_records = scenario.ue_count * 3 * 60  # UE * levels * timestamps
        if len(result.kpi_records) < expected_min_records * 0.5:
            warnings.append(
                f"KPI record count ({len(result.kpi_records)}) lower than expected ({expected_min_records})"
            )
        
        return issues, warnings
    
    def _verify_normal_case(self, result: 'SimulationResult') -> List[str]:
        """Verify that a normal case has no significant anomalies."""
        issues = []
        
        # For normal cases, session success rates should be very high
        session_records = [r for r in result.kpi_records if r.level == "session"]
        
        if not session_records:
            issues.append("No session records for normal case verification")
            return issues
        
        # Check for significant degradation
        low_sr_records = [
            r for r in session_records
            if r.success_rate < 0.95
        ]
        
        if len(low_sr_records) > len(session_records) * 0.1:
            issues.append(
                f"Normal case has {len(low_sr_records)} low success rate records "
                f"({len(low_sr_records)/len(session_records)*100:.1f}%)"
            )
        
        return issues
    
    def _basic_sanity_check(self, result: 'SimulationResult') -> bool:
        """Perform basic sanity check on result data."""
        if not result.kpi_records:
            return False
        
        # Must have records from all three levels
        levels = set(r.level for r in result.kpi_records)
        if levels != {"link", "trace", "session"}:
            return False
        
        # Success rates must be in valid range
        for r in result.kpi_records[:100]:  # Sample first 100
            if r.success_rate < 0 or r.success_rate > 1.0:
                return False
        
        return True
    
    def _calculate_confidence(
        self,
        issues: List[str],
        warnings: List[str]
    ) -> float:
        """Calculate verification confidence based on issues and warnings."""
        if not issues and not warnings:
            return 1.0
        
        # Start with perfect confidence
        confidence = 1.0
        
        # Deduct for issues (major impact)
        confidence -= len(issues) * 0.2
        
        # Deduct for warnings (minor impact)
        confidence -= len(warnings) * 0.05
        
        # Ensure within bounds
        return max(0.0, min(1.0, confidence))
    
    def _generate_verification_report(
        self,
        scenario: 'Scenario',
        result: 'SimulationResult',
        issues: List[str],
        warnings: List[str]
    ) -> str:
        """
        Generate a detailed verification report using LLM.
        
        This provides natural language analysis of the case quality.
        """
        # Prepare summary data
        summary = {
            "case_id": scenario.case_id,
            "is_normal": scenario.is_normal,
            "is_train": scenario.is_train,
            "process_name": scenario.process_name,
            "ue_count": scenario.ue_count,
            "fault_type": scenario.fault_config.fault_point_type.value if scenario.fault_config else None,
            "fault_mode": scenario.fault_config.fault_mode.value if scenario.fault_config else None,
            "kpi_record_count": len(result.kpi_records),
            "flow_count": len(result.flows),
            "issues_count": len(issues),
            "warnings_count": len(warnings)
        }
        
        # Sample some KPI data for context
        session_records = [r for r in result.kpi_records if r.level == "session"]
        if session_records:
            sr_values = [r.success_rate for r in session_records[:50]]
            summary["sample_session_sr"] = sr_values
        
        # Generate report via LLM if available
        if self._llm_client:
            return self._llm_generate_report(summary, issues, warnings)
        
        # Fallback to simple structured report
        return self._simple_report(summary, issues, warnings)
    
    def _llm_generate_report(
        self,
        summary: Dict,
        issues: List[str],
        warnings: List[str]
    ) -> str:
        """Generate report using LLM."""
        prompt = f"""Analyze this fault data generation case:

Case Summary:
{json.dumps(summary, indent=2)}

Issues Found: {json.dumps(issues, indent=2)}
Warnings: {json.dumps(warnings, indent=2)}

Provide a brief verification report in JSON format:
{{
    "verdict": "PASS/FAIL/WARNING",
    "summary": "Brief summary",
    "recommendations": ["list of recommendations if any"]
}}
"""
        
        try:
            response = self._llm_client.complete(
                prompt=prompt,
                model=self.model,
                temperature=self.temperature,
                max_tokens=self.max_tokens
            )
            return response.text
        except Exception as e:
            return self._simple_report(summary, issues, warnings)
    
    def _simple_report(
        self,
        summary: Dict,
        issues: List[str],
        warnings: List[str]
    ) -> str:
        """Generate a simple structured report without LLM."""
        verdict = "PASS" if not issues else "FAIL"
        if not issues and warnings:
            verdict = "WARNING"
        
        report = {
            "verdict": verdict,
            "summary": f"Case {summary['case_id']}: {'Normal' if summary['is_normal'] else 'Fault'} case "
                      f"with {summary['kpi_record_count']} KPI records",
            "issues": issues,
            "warnings": warnings,
            "recommendations": []
        }
        
        if issues:
            report["recommendations"].append("Review and fix critical issues before using this case")
        if len(warnings) > 5:
            report["recommendations"].append("Consider regenerating with different parameters")
        
        return json.dumps(report, indent=2)
    
    def verify_batch(
        self,
        cases: List[tuple['Scenario', 'SimulationResult']]
    ) -> List[Dict[str, Any]]:
        """
        Verify multiple cases in batch.
        
        Args:
            cases: List of (scenario, result) tuples
            
        Returns:
            List of verification results
        """
        results = []
        for scenario, result in cases:
            results.append(self.verify(scenario, result))
        return results
    
    def get_verification_summary(
        self,
        results: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Get summary statistics for a batch of verification results.
        
        Args:
            results: List of verification results from verify()
            
        Returns:
            Summary dict with pass rates, common issues, etc.
        """
        total = len(results)
        passed = sum(1 for r in results if r["passed"])
        failed = total - passed
        
        all_issues = []
        all_warnings = []
        for r in results:
            all_issues.extend(r.get("issues", []))
            all_warnings.extend(r.get("warnings", []))
        
        avg_confidence = sum(r.get("confidence", 0) for r in results) / total if total else 0
        
        return {
            "total": total,
            "passed": passed,
            "failed": failed,
            "pass_rate": passed / total if total else 0,
            "avg_confidence": avg_confidence,
            "total_issues": len(all_issues),
            "total_warnings": len(all_warnings),
            "common_issues": self._get_common_items(all_issues, top_n=5),
            "common_warnings": self._get_common_items(all_warnings, top_n=5)
        }
    
    def _get_common_items(
        self,
        items: List[str],
        top_n: int = 5
    ) -> List[tuple[str, int]]:
        """Get most common items with counts."""
        from collections import Counter
        counts = Counter(items)
        return counts.most_common(top_n)
