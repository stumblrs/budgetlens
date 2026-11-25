# 2026 Naira benchmarks for human-scale equivalencies
BASELINE_TEACHER_SALARY = 1200000     # ₦1.2M annual primary teacher salary
BASELINE_SOLAR_BOREHOLE = 10000000    # ₦10M per solar borehole
BASELINE_HEALTH_CENTRE = 50000000     # ₦50M per primary healthcare centre

class HumanEquivalents:
    """Stage 4: Calculates human-scale equivalencies for project allocations."""

    @staticmethod
    def compute(amount: int) -> dict:
        if amount <= 0:
            return {
                "teacherSalaries": "N/A",
                "solarBoreholes": "N/A",
                "primaryHealthCentres": "N/A"
            }

        teachers = round(amount / BASELINE_TEACHER_SALARY)
        boreholes = round(amount / BASELINE_SOLAR_BOREHOLE)
        clinics = round(amount / BASELINE_HEALTH_CENTRE)

        return {
            "teacherSalaries": f"≈ {teachers:,} primary school teacher annual salaries" if teachers > 0 else "Under 1 teacher salary",
            "solarBoreholes": f"≈ {boreholes:,} solar boreholes (₦10M baseline)" if boreholes > 0 else "Under 1 borehole baseline",
            "primaryHealthCentres": f"≈ {clinics:,} primary health centres (₦50M baseline)" if clinics > 0 else "Under 1 clinic baseline"
        }
