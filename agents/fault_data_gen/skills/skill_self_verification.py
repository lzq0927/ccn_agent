"""
Self-Verification Skill for Fault Data Generation

This skill performs LLM-based verification of generated fault data cases.
It validates that:
1. Faults are properly configured and activated
2. KPI data shows expected patterns
3. Normal cases are clean
4. Data quality meets standards

Usage:
    from agents.fault_data_gen.skills.skill_self_verification import SelfVerificationSkill
    
    skill = SelfVerificationSkill()
    result = skill.execute(case_data)
"""

import json
import re
from typing import Dict, List, Any, Optional
from dataclasses import dataclass


@dataclass
class VerificationCriteria:
    """Criteria for verifying a generated case."""
    check_fault_timing: bool = True
    check_kpi_anomalies: bool = True
    check_data_completeness: bool = True
    check_normal_case_cleanliness: bool = True
    check_success_rate_ranges: bool = True


@dataclass
class VerificationResult:
    """Result of a verification check."""
    passed: bool
    score: float  # 0.0 to 1.0
    criteria_met: Dict[str, bool]
    issues: List[str]
    warnings: List[str]
    details: str


class SelfVerificationSkill:
    """
    Skill for self-verification of generated fault data.
    
    This skill analyzes generated cases and verifies their quality
    before they are added to the CaseLibrary.
    """
    
    def __init__(self, llm_client=None):
        """
        Initialize the verification skill.
        
        Args:
            llm_client: Optional LLM client for advanced verification
        """
        self.llm_client = llm_client
        self.criteria = VerificationCriteria()
    
    def execute(
        self,
        case_data: Dict[str, Any],
        criteria: VerificationCriteria = None
    ) -> VerificationResult:
        """
        Execute verification on a case.
        
        Args:
            case_data: Dictionary containing:
                - scenario: Scenario object
                - result: SimulationResult object
                - kpi_data: Optional KPI data dict
                - topo_data: Optional topology data dict
            criteria: Optional custom verification criteria
            
        Returns:
            VerificationResult with pass/fail and details
        """
        criteria = criteria or self.criteria
        
        issues = []
        warnings = []
        criteria_met = {}
        score = 1.0
        
        # Extract data
        scenario = case_data.get("scenario")
        result = case_data.get("result")
        kpi_data = case_data.get("kpi_data", {})
        topo_data = case_data.get("topo_data", {})
        
        if scenario is None or result is None:
            return VerificationResult(
                passed=False,
                score=0.0,
                criteria_met={},
                issues=["Missing scenario or result data"],
                warnings=[],
                details="Error: Required data missing"
            )
        
        # Run verification checks
        if criteria.check_fault_timing:
            timing_result = self._check_fault_timing(scenario, result)
            criteria_met["fault_timing"] = timing_result["passed"]
            if not timing_result["passed"]:
                issues.extend(timing_result["issues"])
                score -= 0.3
            warnings.extend(timing_result.get("warnings", []))
        
        if criteria.check_kpi_anomalies:
            anomaly_result = self._check_kpi_anomalies(scenario, result)
            criteria_met["kpi_anomalies"] = anomaly_result["passed"]
            if not anomaly_result["passed"]:
                issues.extend(anomaly_result["issues"])
                score -= 0.25
            warnings.extend(anomaly_result.get("warnings", []))
        
        if criteria.check_data_completeness:
            completeness_result = self._check_data_completeness(result)
            criteria_met["data_completeness"] = completeness_result["passed"]
            if not completeness_result["passed"]:
                issues.extend(completeness_result["issues"])
                score -= 0.2
        
        if criteria.check_normal_case_cleanliness and scenario.is_normal:
            cleanliness_result = self._check_normal_case_cleanliness(result)
            criteria_met["normal_cleanliness"] = cleanliness_result["passed"]
            if not cleanliness_result["passed"]:
                issues.extend(cleanliness_result["issues"])
                score -= 0.35
        
        if criteria.check_success_rate_ranges:
            range_result = self._check_success_rate_ranges(result)
            criteria_met["sr_ranges"] = range_result["passed"]
            if not range_result["passed"]:
                warnings.extend(range_result["warnings"])
                score -= 0.1
        
        # Ensure score bounds
        score = max(0.0, min(1.0, score))
        
        # Determine pass/fail
        passed = len(issues) == 0 and score >= 0.7
        
        # Generate details
        details = self._generate_details(
            scenario, result, criteria_met, issues, warnings, score
        )
        
        return VerificationResult(
            passed=passed,
            score=score,
            criteria_met=criteria_met,
            issues=issues,
            warnings=warnings,
            details=details
        )
    
    def _check_fault_timing(
        self,
        scenario: 'Scenario',
        result: 'SimulationResult'
    ) -> Dict[str, Any]:
        """Check that fault is properly timed."""
        issues = []
        warnings = []
        
        fc = scenario.fault_config
        
        # Normal cases should have no fault config
        if scenario.is_normal:
            if fc is not None:
                issues.append("Normal case has non-null fault_config")
            return {"passed": len(issues) == 0, "issues": issues, "warnings": warnings}
        
        # Fault cases must have fault config
        if fc is None:
            issues.append("Fault case has null fault_config")
            return {"passed": False, "issues": issues, "warnings": warnings}
        
        # Check fault timing parameters
        if fc.fault_start < 1 or fc.fault_start > 55:
            issues.append(f"fault_start out of valid range: {fc.fault_start}")
        
        if fc.fault_duration < 1 or fc.fault_duration > 40:
            issues.append(f"fault_duration out of valid range: {fc.fault_duration}")
        
        if fc.fault_start + fc.fault_duration > 60:
            issues.append(f"fault extends beyond simulation window")
        
        # Check that KPIs show expected degradation during fault window
        session_records = [r for r in result.kpi_records if r.level == "session"]
        if session_records:
            fault_window_start = fc.fault_start
            fault_window_end = fc.fault_start + fc.fault_duration
            
            during_fault = [
                r.success_rate for r in session_records
                if fault_window_start <= r.timestamp < fault_window_end
            ]
            
            if during_fault:
                avg_during = sum(during_fault) / len(during_fault)
                # For a fault to be detectable, success rate should drop
                if avg_during > 0.99:
                    warnings.append(
                        f"Fault window success rate ({avg_during:.4f}) suspiciously high"
                    )
        
        return {"passed": len(issues) == 0, "issues": issues, "warnings": warnings}
    
    def _check_kpi_anomalies(
        self,
        scenario: 'Scenario',
        result: 'SimulationResult'
    ) -> Dict[str, Any]:
        """Check that KPI data shows expected anomaly patterns."""
        issues = []
        warnings = []
        
        # Check for link, trace, session levels
        levels = set(r.level for r in result.kpi_records)
        required_levels = {"link", "trace", "session"}
        
        missing = required_levels - levels
        if missing:
            issues.append(f"Missing KPI levels: {missing}")
        
        # For fault cases, check if anomalies are present during fault window
        if not scenario.is_normal and scenario.fault_config:
            fc = scenario.fault_config
            fault_window = range(fc.fault_start, fc.fault_start + fc.fault_duration)
            
            # Get session records during fault
            during_fault = [
                r for r in result.kpi_records
                if r.level == "session" and r.timestamp in fault_window
            ]
            
            # Check for success rate degradation
            if during_fault:
                success_rates = [r.success_rate for r in during_fault]
                min_sr = min(success_rates)
                
                # If fault mode is LINK, expect link-level anomalies
                if fc.fault_mode.value == "link":
                    if min_sr > 0.95:
                        warnings.append(
                            f"LINK fault but session success rates remain high (min: {min_sr:.4f})"
                        )
        
        return {"passed": len(issues) == 0, "issues": issues, "warnings": warnings}
    
    def _check_data_completeness(
        self,
        result: 'SimulationResult'
    ) -> Dict[str, Any]:
        """Check that data is complete."""
        issues = []
        
        if not result.kpi_records:
            issues.append("No KPI records found")
            return {"passed": False, "issues": issues}
        
        # Check timestamp coverage
        timestamps = set(r.timestamp for r in result.kpi_records)
        if len(timestamps) < 50:  # Should have at least 50 timestamps
            issues.append(f"Limited timestamp coverage: {len(timestamps)} unique timestamps")
        
        # Check for each level
        for level in ["link", "trace", "session"]:
            level_records = [r for r in result.kpi_records if r.level == level]
            if not level_records:
                issues.append(f"No {level} records found")
        
        return {"passed": len(issues) == 0, "issues": issues}
    
    def _check_normal_case_cleanliness(
        self,
        result: 'SimulationResult'
    ) -> Dict[str, Any]:
        """Check that normal case has no significant faults."""
        issues = []
        
        session_records = [r for r in result.kpi_records if r.level == "session"]
        
        if not session_records:
            issues.append("No session records to verify")
            return {"passed": False, "issues": issues}
        
        # Check for significant degradation
        low_sr_count = sum(1 for r in session_records if r.success_rate < 0.95)
        low_sr_ratio = low_sr_count / len(session_records)
        
        if low_sr_ratio > 0.05:  # More than 5% degraded
            issues.append(
                f"Normal case has {low_sr_ratio:.1%} degraded session records"
            )
        
        return {"passed": len(issues) == 0, "issues": issues}
    
    def _check_success_rate_ranges(
        self,
        result: 'SimulationResult'
    ) -> Dict[str, Any]:
        """Check that success rates are in valid ranges."""
        warnings = []
        
        for record in result.kpi_records:
            if not (0.0 <= record.success_rate <= 1.0):
                warnings.append(
                    f"Invalid success_rate {record.success_rate} at timestamp {record.timestamp}"
                )
        
        return {"passed": len(warnings) == 0, "warnings": warnings}
    
    def _generate_details(
        self,
        scenario: 'Scenario',
        result: 'SimulationResult',
        criteria_met: Dict[str, bool],
        issues: List[str],
        warnings: List[str],
        score: float
    ) -> str:
        """Generate detailed verification report."""
        fc = scenario.fault_config
        
        details = {
            "case_id": scenario.case_id,
            "case_type": "normal" if scenario.is_normal else "fault",
            "process": scenario.process_name,
            "ue_count": scenario.ue_count,
            "topology_elements": len(scenario.topology.elements),
            "kpi_record_count": len(result.kpi_records),
            "flow_count": len(result.flows),
            "criteria_results": criteria_met,
            "overall_score": score,
            "issue_count": len(issues),
            "warning_count": len(warnings),
            "fault_details": None if fc is None else {
                "type": fc.fault_point_type.value,
                "mode": fc.fault_mode.value,
                "loss_rate": fc.loss_rate,
                "start": fc.fault_start,
                "duration": fc.fault_duration,
                "affected_ne_count": len(fc.affected_ne_ids)
            }
        }
        
        if issues:
            details["issues"] = issues
        if warnings:
            details["warnings"] = warnings
        
        return json.dumps(details, indent=2)
    
    def verify_with_llm(
        self,
        case_data: Dict[str, Any],
        prompt_template: str = None
    ) -> VerificationResult:
        """
        Perform verification using LLM for advanced analysis.
        
        Args:
            case_data: Case data dictionary
            prompt_template: Optional custom prompt template
            
        Returns:
            VerificationResult from LLM analysis
        """
        if self.llm_client is None:
            # Fall back to non-LLM verification
            return self.execute(case_data)
        
        # Build prompt
        scenario = case_data.get("scenario")
        result = case_data.get("result")
        
        prompt = prompt_template or self._get_default_prompt()
        
        # Fill in case details
        prompt = prompt.format(
            case_id=scenario.case_id,
            is_normal=scenario.is_normal,
            process_name=scenario.process_name,
            ue_count=scenario.ue_count,
            fault_type=scenario.fault_config.fault_point_type.value if scenario.fault_config else "N/A",
            fault_mode=scenario.fault_config.fault_mode.value if scenario.fault_config else "N/A",
            kpi_count=len(result.kpi_records)
        )
        
        try:
            response = self.llm_client.complete(
                prompt=prompt,
                temperature=0.1,
                max_tokens=2048
            )
            
            # Parse LLM response
            return self._parse_llm_response(response.text, case_data)
            
        except Exception as e:
            # Fall back to non-LLM verification
            return self.execute(case_data)
    
    def _get_default_prompt(self) -> str:
        """Get the default verification prompt."""
        return """You are a fault data verification expert. Analyze this fault case:

Case ID: {case_id}
Type: {case_type}
Process: {process_name}
UE Count: {ue_count}
Fault Type: {fault_type}
Fault Mode: {fault_mode}
KPI Records: {kpi_count}

Verify this case and respond with JSON:
{{
    "verdict": "PASS/FAIL",
    "score": 0.0-1.0,
    "reasoning": "explanation",
    "issues": ["list of issues if any"],
    "suggestions": ["improvements if needed"]
}}
"""
    
    def _parse_llm_response(
        self,
        response_text: str,
        case_data: Dict[str, Any]
    ) -> VerificationResult:
        """Parse LLM response into VerificationResult."""
        try:
            # Try to extract JSON from response
            json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
            if json_match:
                data = json.loads(json_match.group())
                
                verdict = data.get("verdict", "FAIL").upper()
                passed = verdict == "PASS"
                score = float(data.get("score", 0.5))
                issues = data.get("issues", [])
                warnings = data.get("suggestions", [])
                
                return VerificationResult(
                    passed=passed,
                    score=score,
                    criteria_met={},
                    issues=issues,
                    warnings=warnings,
                    details=response_text
                )
        except (json.JSONDecodeError, KeyError, ValueError):
            pass
        
        # Fallback
        return VerificationResult(
            passed=False,
            score=0.0,
            criteria_met={},
            issues=["Failed to parse LLM response"],
            warnings=[],
            details=response_text
        )
