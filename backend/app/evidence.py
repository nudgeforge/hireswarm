"""Deterministic evidence matching and claim validation.

This is intentionally non-LLM logic. It makes HireSwarm auditable: an LLM may
suggest wording, but code decides whether a claim can be promoted to the final
application packet.
"""
from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

from .data import ADJACENT_SKILLS, SKILL_ALIASES, has_alias


SKILL_LABELS = {
    "fastapi": "FastAPI",
    "rest apis": "REST APIs",
    "postgresql": "PostgreSQL",
    "ci/cd": "CI/CD",
    "llm applications": "LLM applications",
    "node.js": "Node.js",
    "typescript": "TypeScript",
    "javascript": "JavaScript",
    "html": "HTML",
    "css": "CSS",
    "sql": "SQL",
    "design systems": "Design systems",
    "product analytics": "Product analytics",
}


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def candidate_skill_index(candidate: dict[str, Any]) -> dict[str, list[str]]:
    index: dict[str, list[str]] = defaultdict(list)
    for evidence in candidate.get("evidence", []):
        # Drafts or unverified notes may be retained for the applicant's review,
        # but never become proof in matching, interviewing, or exports.
        if evidence.get("status", "verified") != "verified":
            continue
        evidence_id = evidence.get("evidence_id", "")
        content = normalize(" ".join(evidence.get("skills", [])) + " " + evidence.get("source_text", ""))
        for normalized_skill, aliases in SKILL_ALIASES.items():
            if any(has_alias(content, alias) for alias in aliases):
                index[normalized_skill].append(evidence_id)
    return dict(index)


def evidence_for_skill(skill: str, skill_index: dict[str, list[str]]) -> list[str]:
    key = normalize(skill)
    if key in skill_index:
        return skill_index[key]
    for normalized, aliases in SKILL_ALIASES.items():
        if key == normalized or key in aliases:
            return skill_index.get(normalized, [])
    return []


def score_job(job: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    skill_index = candidate_skill_index(candidate)
    must_have = job.get("must_have", [])
    preferred = job.get("preferred", [])
    verified: list[dict[str, Any]] = []
    adjacent: list[dict[str, Any]] = []
    gaps: list[dict[str, Any]] = []

    for skill in must_have:
        ids = evidence_for_skill(skill, skill_index)
        if ids:
            verified.append({"skill": skill, "evidence_ids": ids})
        else:
            related = []
            for adjacent_skill in ADJACENT_SKILLS.get(skill, []):
                related += evidence_for_skill(adjacent_skill, skill_index)
            if related:
                adjacent.append({"skill": skill, "evidence_ids": sorted(set(related)), "reason": "related verified experience"})
                # Adjacent experience is useful context but not direct evidence.
                gaps.append({"skill": skill, "severity": "adjacent_only"})
            else:
                gaps.append({"skill": skill, "severity": "must_have"})

    for skill in preferred:
        ids = evidence_for_skill(skill, skill_index)
        if ids:
            verified.append({"skill": skill, "evidence_ids": ids, "preferred": True})
        else:
            related = []
            for adjacent_skill in ADJACENT_SKILLS.get(skill, []):
                related += evidence_for_skill(adjacent_skill, skill_index)
            if related:
                adjacent.append({"skill": skill, "evidence_ids": sorted(set(related)), "reason": "adjacent preferred experience", "preferred": True})
                gaps.append({"skill": skill, "severity": "adjacent_only"})
            else:
                gaps.append({"skill": skill, "severity": "preferred"})

    must_weight = max(1, len(must_have)) * 12
    preferred_weight = max(1, len(preferred)) * 4
    value = len([x for x in verified if not x.get("preferred")]) * 12
    value += len([x for x in adjacent if not x.get("preferred")]) * 6
    value += len([x for x in verified if x.get("preferred")]) * 4
    value += len([x for x in adjacent if x.get("preferred")]) * 2
    total = must_weight + preferred_weight
    # A fit score should never imply evidence where none exists. Keep the
    # historical floor only after at least one direct or adjacent signal exists.
    score = 0 if not verified and not adjacent else min(97, max(18, round(25 + (value / total) * 72)))
    # Coverage is intentionally stricter than fit: adjacent experience helps the
    # fit score but does not masquerade as direct evidence for a requirement.
    direct_value = len([x for x in verified if not x.get("preferred")]) * 12
    direct_value += len([x for x in verified if x.get("preferred")]) * 4
    coverage = min(100, max(0, round((direct_value / total) * 100)))

    return {
        "score": score,
        "coverage": coverage,
        "verified_strengths": verified,
        "adjacent_strengths": adjacent,
        "gaps": gaps,
        "skill_index": skill_index,
    }


def build_interview(job: dict[str, Any], candidate: dict[str, Any], match: dict[str, Any]) -> list[dict[str, Any]]:
    # For the flagship demo scenario, use authored questions only when the
    # canonical demo evidence IDs are actually present. User-provided resumes
    # use the generic evidence-bound question generator below.
    candidate_ids = {item.get("evidence_id") for item in candidate.get("evidence", []) if item.get("status", "verified") == "verified"}
    if job.get("interview_questions") and {"ev_03", "ev_04"}.issubset(candidate_ids):
        return job["interview_questions"]

    questions = []
    skill_index = match["skill_index"]
    must_have = list(job.get("must_have", []))
    preferred = list(job.get("preferred", []))
    all_skills = must_have + preferred
    # A compact rehearsal has at most four prompts, but it must not quietly
    # skip a later must-have gap just because earlier requirements were direct
    # matches. Keep the first requirements for context and reserve one slot for
    # the first unrepresented must-have without direct proof.
    interview_skills = all_skills[:4]
    later_must_gap = next((
        skill for skill in must_have
        if skill not in interview_skills and not evidence_for_skill(skill, skill_index)
    ), None)
    # If all later must-haves are covered, a later preferred gap is still more
    # useful in a rehearsal than a fourth already-proven direct requirement.
    later_gap = later_must_gap or next((
        skill for skill in all_skills
        if skill not in interview_skills and not evidence_for_skill(skill, skill_index)
    ), None)
    if later_gap:
        if interview_skills:
            interview_skills[-1] = later_gap
        else:
            interview_skills = [later_gap]
    for skill in list(dict.fromkeys(interview_skills)): 
        ids = evidence_for_skill(skill, skill_index)
        if ids:
            questions.append({
                "requirement": skill,
                "question": f"Tell me about a project where you applied {skill}. What was your contribution and outcome?",
                "answer": f"I can discuss verified experience relevant to {skill} and point to the underlying project evidence.",
                "status": "SUPPORTED",
                "evidence_ids": ids,
                "verdict": f"Verified evidence supports {skill}.",
            })
        else:
            related = []
            for rel in ADJACENT_SKILLS.get(skill, []):
                related += evidence_for_skill(rel, skill_index)
            questions.append({
                "requirement": skill,
                "question": f"What direct evidence can you offer for {skill} in this role?",
                "answer": f"I do not have verified direct evidence for {skill}; I would treat this as a learning gap rather than claim it.",
                "status": "PARTIAL" if related else "UNSUPPORTED",
                "evidence_ids": sorted(set(related)),
                "verdict": f"No direct verified {skill} evidence is available.",
            })
    return questions or [{
        "requirement": "Role fit",
        "question": "Which verified project best demonstrates your fit for this role?",
        "answer": "I will point to the most relevant evidence-backed project.",
        "status": "SUPPORTED",
        "evidence_ids": [e.get("evidence_id") for e in candidate.get("evidence", []) if e.get("status", "verified") == "verified"][:1],
        "verdict": "Evidence-led answer available.",
    }]


def build_safe_patches(job: dict[str, Any], candidate: dict[str, Any], match: dict[str, Any]) -> list[dict[str, Any]]:
    """Choose literal, verified evidence for requirements in the target role.

    The target's requirement order determines the document priority. There is
    deliberately no backend-demo shortcut here: React, testing, PostgreSQL, or
    any other directly verified taxonomy term receives the same treatment as
    FastAPI. The function never rewrites the applicant's wording.
    """
    verified_evidence = {
        item.get("evidence_id"): item
        for item in candidate.get("evidence", [])
        if item.get("evidence_id") and item.get("status", "verified") == "verified"
    }
    target_order = job.get("must_have", []) + job.get("preferred", [])
    direct_by_skill = {
        str(strength.get("skill")): strength
        for strength in match.get("verified_strengths", [])
        if strength.get("skill")
    }

    patches: list[dict[str, Any]] = []
    for skill in target_order:
        strength = direct_by_skill.get(str(skill))
        if not strength:
            continue
        for evidence_id in strength.get("evidence_ids", []):
            item = verified_evidence.get(evidence_id)
            if not item or not item.get("source_text"):
                continue
            source = str(item["source_text"])
            patches.append({
                "section": str(item.get("source_section") or "Relevant experience"),
                "original": source,
                "proposed": source.rstrip(".") + ".",
                "evidence_ids": [evidence_id],
                "covered_requirements": [str(skill)],
                "status": "safe_to_apply",
                "reason": "Prioritizes a literal, verified source statement that directly supports this target requirement.",
            })
            break

    # One literal CV sentence can substantiate several requirements. It must
    # render once in the tailored document while retaining every requirement
    # and evidence ID it supports.
    deduplicated: list[dict[str, Any]] = []
    by_literal: dict[str, dict[str, Any]] = {}
    for patch in patches:
        key = normalize(str(patch["proposed"]))
        existing = by_literal.get(key)
        if existing is None:
            by_literal[key] = patch
            deduplicated.append(patch)
            continue
        existing["evidence_ids"] = list(dict.fromkeys([*existing["evidence_ids"], *patch["evidence_ids"]]))
        existing["covered_requirements"] = list(dict.fromkeys([*existing["covered_requirements"], *patch["covered_requirements"]]))
    return deduplicated[:3]


def validate_patches(patches: list[dict[str, Any]], candidate: dict[str, Any]) -> dict[str, Any]:
    allowed = {item.get("evidence_id") for item in candidate.get("evidence", []) if item.get("status", "verified") == "verified"}
    safe, blocked = [], []
    for patch in patches:
        ids = patch.get("evidence_ids", [])
        linked = bool(ids) and all(eid in allowed for eid in ids)
        role_relevant = bool(patch.get("covered_requirements"))
        if linked and role_relevant:
            safe.append(patch)
        else:
            invalid = {eid for eid in ids if eid not in allowed}
            reason = f"Missing verified evidence IDs: {', '.join(invalid) or 'none'}" if not linked else "No target-role requirement is covered by this revision."
            blocked.append({**patch, "block_reason": reason})
    return {
        "safe_patches": safe,
        "blocked_patches": blocked,
        "all_claims_linked": len(blocked) == 0,
    }


def cover_letter_evidence_ids(job: dict[str, Any], candidate: dict[str, Any], match: dict[str, Any]) -> list[str]:
    """Return the exact ledger nodes allowed to support the cover-letter draft."""
    available = {item.get("evidence_id") for item in candidate.get("evidence", []) if item.get("status", "verified") == "verified"}
    ids: list[str] = []
    for strength in match.get("verified_strengths", []):
        for evidence_id in strength.get("evidence_ids", []):
            if evidence_id in available and evidence_id not in ids:
                ids.append(evidence_id)
    # A role may be too broad to map a named skill. In that case preserve a
    # small literal sample rather than inventing a narrative.
    if not ids:
        ids = [item.get("evidence_id") for item in candidate.get("evidence", []) if item.get("evidence_id") and item.get("status", "verified") == "verified"][:2]
    return ids[:3]


def build_cover_letter(job: dict[str, Any], candidate: dict[str, Any], match: dict[str, Any]) -> str:
    """Draft from literal candidate evidence, including explicit limitations.

    This is intentionally conservative. A polished letter is not allowed to
    introduce technologies, metrics, ownership, or a growth plan the applicant
    did not supply as evidence.
    """
    name = candidate.get("name", "the candidate")
    company = job.get("company", "your team")
    title = job.get("title", "this role")
    evidence_by_id = {item.get("evidence_id"): item for item in candidate.get("evidence", [])}
    ids = cover_letter_evidence_ids(job, candidate, match)
    source_lines = [str(evidence_by_id[evidence_id].get("source_text", "")).rstrip(".") + "." for evidence_id in ids if evidence_id in evidence_by_id]
    direct_skills = [item.get("skill") for item in match.get("verified_strengths", []) if item.get("skill") and not item.get("preferred")]
    gaps = [item.get("skill") for item in match.get("gaps", []) if item.get("skill") and item.get("severity") in {"must_have", "adjacent_only"}]

    opening = f"I am writing to apply for the {title} opportunity."
    if source_lines:
        evidence_paragraph = "My application is grounded in the following verified work: " + " ".join(source_lines)
        relevance = f"This provides direct evidence relevant to {', '.join(direct_skills[:4])}." if direct_skills else "I would welcome the opportunity to discuss the most relevant verified work in more detail."
    else:
        evidence_paragraph = "I do not yet have source-linked experience statements selected for this role, so I would not claim a tailored technical match."
        relevance = "I would first review and add accurate evidence before submitting this application."

    transparency = ""
    if gaps:
        transparency = f"I also want to be transparent that I do not have direct, verified evidence for {', '.join(gaps[:3])}. I would not represent those areas as existing experience."

    paragraphs = [
        f"Dear {company} hiring team,",
        opening,
        f"{evidence_paragraph} {relevance}",
        transparency,
        f"Sincerely,\n{name}",
    ]
    return "\n\n".join(paragraph for paragraph in paragraphs if paragraph)


# Preserve literal numbers exactly as supplied. A candidate's "2,000 users"
# must never become "000 users" simply because a comma is not part of a basic
# numeric regex. The expression intentionally covers only clear measures, not
# date ranges or arbitrary numbers in a CV.
METRIC_PATTERN = re.compile(
    r"(?:"
    r"[$€£]\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?"
    r"|(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:%|percent|users?|customers?|clients?|hours?|days?|weeks?|months?|years?|ms|seconds?|minutes?|records?|requests?|downloads?)"
    r")",
    re.I,
)

_SECTION_TITLES = {
    "experience": "Experience",
    "work experience": "Experience",
    "professional experience": "Experience",
    "projects": "Projects",
    "project experience": "Projects",
    "skills": "Skills",
    "technical skills": "Technical skills",
    "tech stack": "Technical skills",
    "technologies": "Technical skills",
    "tools": "Technical skills",
}
_SKILL_SECTIONS = {"Skills", "Technical skills"}
_SKILL_LIST_PREFIX = re.compile(r"^\s*(?:skills?|technical\s+skills?|tech(?:nology|nologies)?|tech\s+stack|tools?)\s*[:\-]", re.I)
# Sentence-level CV prose often begins with "I" or a project name rather than
# an action verb. Require an explicit technical-work signal anywhere in the
# line; this still avoids treating a bare headline such as "Docker developer"
# as evidence.
_TECHNICAL_SENTENCE_SIGNAL = re.compile(
    r"\b(?:built|developed|designed|implemented|created|led|managed|delivered|improved|reduced|optimized|automated|dockerized|containerized|deployed|configured|used|using|utilized|worked\s+with|tested|maintained|migrated|integrated|analyzed|wrote|launched|supported|contributed|experience\s+with)\b",
    re.I,
)


def _resume_section(line: str) -> str | None:
    compact = normalize(re.sub(r"[:\-–—]+$", "", line))
    return _SECTION_TITLES.get(compact)


def _skills_mentioned_in(line: str) -> list[str]:
    text = normalize(line)
    found = []
    for normalized_skill, aliases in SKILL_ALIASES.items():
        if any(has_alias(text, alias) for alias in aliases):
            # Preserve conventional technical capitalization in the ledger/UI.
            found.append(SKILL_LABELS.get(normalized_skill, normalized_skill.title()))
    return sorted(set(found))


def extract_evidence_from_resume(resume_text: str) -> list[dict[str, Any]]:
    """Create a literal, reviewable work-example ledger from a CV.

    In addition to action/impact bullets, applicants often give direct tool
    proof in project tech stacks and skills lists. Those literal CV lines are
    useful evidence when the named skill is actually present; this function
    records them without inventing scope, ownership, or outcomes.
    """
    lines = [re.sub(r"^[\s•\-–—]+", "", line).strip() for line in resume_text.splitlines()]
    # A headline such as "Frontend developer" may contain a taxonomy alias but
    # is not proof of work. Conversely, "Containerized services with Docker"
    # is a literal action statement and must not be dropped.
    action = re.compile(
        r"^(?:built|developed|designed|implemented|created|led|managed|owned|delivered|improved|reduced|increased|optimized|automated|collaborated|dockerized|containerized|deployed|configured|used|utilized|worked\s+with|tested|maintained|migrated|integrated|analyzed|wrote|launched|supported|contributed)\b",
        re.I,
    )
    evidence: list[dict[str, Any]] = []
    seen_lines: set[str] = set()
    section = "Candidate-provided resume"

    for line in lines:
        if not line:
            continue
        heading = _resume_section(line)
        if heading:
            section = heading
            continue
        if len(line) < 3:
            continue

        found = _skills_mentioned_in(line)
        metric_matches = [match.group(0) for match in METRIC_PATTERN.finditer(line)]
        is_action = bool(action.search(line))
        # A literal skill/tech list is direct self-reported CV evidence. We do
        # not infer a skill from generic words such as "container architecture";
        # a known alias must appear on the original line.
        is_skill_list = bool(found) and (
            section in _SKILL_SECTIONS
            or bool(_SKILL_LIST_PREFIX.match(line))
            or (len(found) >= 2 and any(separator in line for separator in (",", "|", ";", ":")))
        )
        is_technical_sentence = bool(found) and bool(_TECHNICAL_SENTENCE_SIGNAL.search(line))
        if not (is_action or metric_matches or is_skill_list or is_technical_sentence):
            continue
        if not found and not metric_matches:
            # An action with no named skill or measurable outcome is too broad
            # to become a reusable application claim.
            continue

        dedupe_key = normalize(line)
        if dedupe_key in seen_lines:
            continue
        seen_lines.add(dedupe_key)
        evidence.append({
            "evidence_id": f"cv_{len(evidence)+1:02d}",
            "source_section": section,
            "source_text": line,
            "skills": found,
            # A ledger row has one metric field, so retain every literal measure
            # in source order rather than silently discarding later values.
            "metric": "; ".join(metric_matches) if metric_matches else None,
            "status": "verified",
        })
        if len(evidence) >= 12:
            break
    return evidence
