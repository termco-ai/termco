# Termco Profiles, Onboarding, and Releases

This context names the portable setup, guided-learning, and independently released plugin concepts used by Termco. A company profile is a developer-controlled template, never a management or enforcement mechanism.

## Profiles

**Termco Profile**:
A named configuration of Termco plugins and ordinary preference defaults that can be activated as a whole.
_Avoid_: Policy, enrollment, device management

**Profile Package**:
A portable, versioned ZIP containing one Termco Profile and the complete source folders, defaults, assets, and onboarding content needed to reproduce it.
_Avoid_: Installer, managed bundle, organization policy

**Imported Revision**:
A locally installed, unchanged version of a Profile Package that remains available for selection, comparison, and rollback.
_Avoid_: Managed profile, enforced profile

**Personal Derivative**:
An unrestricted developer-owned Termco Profile created from an Imported Revision when the developer customizes it.
_Avoid_: Override policy, managed exception

**Profile Origin**:
Optional metadata that identifies where Termco can check whether a newer Profile Package is available.
_Avoid_: Control plane, enrollment server

**Termco Default**:
The profile shipped by Termco and always available as a developer-selectable return point.
_Avoid_: Mandatory baseline

## Onboarding

**Onboarding Journey**:
An ordered, resumable set of steps that helps a developer understand or configure Termco, a Profile Package, or a plugin.
_Avoid_: Wizard, job, workflow

**Onboarding Step**:
One versioned piece of guidance, interaction, verification, or reviewed action within an Onboarding Journey.
_Avoid_: Task, command

**Onboarding Target**:
A stable semantic identity for a visible or revealable Termco interface element used by tours and interaction steps.
_Avoid_: CSS selector, DOM path

**Onboarding Contribution**:
Journeys, steps, targets, or media owned by a plugin and present only while that plugin is selected.
_Avoid_: Hard-coded integration

**Onboarding Progress**:
Local developer state recording completion or dismissal of a specific version of an Onboarding Step.
_Avoid_: Company tracking, telemetry

## Releases

**Plugin Guide**:
Stable user-facing documentation that explains a plugin's purpose, capabilities, and use without describing its release history.
_Avoid_: Version history, release notes

**Plugin Changelog**:
A user-facing history whose entries are owned by exact plugin versions and describe what changed in each version.
_Avoid_: Plugin Guide, application changelog

**Plugin Release Note**:
The current plugin version's changelog entry carried by a signed plugin release and shown during update review.
_Avoid_: Plugin description, commit message
