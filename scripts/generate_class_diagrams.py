from pathlib import Path
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfgen.canvas import Canvas

OUT = Path("output/class-diagrams/niramoy-class-diagrams.pdf")
W, H = landscape(A4)


def txt(c, x, y, value, size=9, bold=False, italic=False, center=False):
    c.setFillColorRGB(0, 0, 0)
    font = "Times-BoldItalic" if bold and italic else "Times-Bold" if bold else "Times-Italic" if italic else "Times-Roman"
    c.setFont(font, size)
    (c.drawCentredString if center else c.drawString)(x, y, value)


def arrow(c, x1, y1, x2, y2, dashed=False):
    c.setStrokeColorRGB(0, 0, 0)
    c.setFillColorRGB(0, 0, 0)
    c.setLineWidth(1)
    c.setDash(3, 3) if dashed else c.setDash()
    c.line(x1, y1, x2, y2)
    c.setDash()
    c.line(x2, y2, x2 - 7, y2 + 4)
    c.line(x2, y2, x2 - 7, y2 - 4)


def cls(c, x, y, w, h, name, attrs, methods, stereotype=None):
    c.setFillColorRGB(0.98, 0.98, 0.98)
    c.setStrokeColorRGB(0, 0, 0)
    c.rect(x, y, w, h, stroke=1, fill=1)
    c.setFillColorRGB(0.93, 0.93, 0.93)
    c.rect(x, y + h - 25, w, 25, stroke=1, fill=1)
    title_y = y + h - 18
    if stereotype:
        txt(c, x + w / 2, title_y + 1, stereotype, 8, italic=True, center=True)
        title_y -= 12
    txt(c, x + w / 2, title_y, name, 11, bold=True, center=True)
    top = y + h - (52 if stereotype else 42)
    for i, value in enumerate(attrs):
        txt(c, x + 10, top - i * 14, value)
    divider = top - len(attrs) * 14 - 7
    c.line(x, divider, x + w, divider)
    for i, value in enumerate(methods):
        txt(c, x + 10, divider - 15 - i * 14, value)


def title(c, name, subtitle):
    txt(c, W / 2, H - 28, name, 18, bold=True, center=True)
    txt(c, W / 2, H - 45, subtitle, 10, italic=True, center=True)


def component_page(c, component, analysis, analysis_attrs, analysis_methods, design_component, interfaces, design_attrs, design_methods, extra):
    title(c, f"Niramoy — {component} Class Diagram", "Simple analysis-to-design view")
    txt(c, 180, H - 82, "Analysis Class", 16, bold=True, italic=True, center=True)
    cls(c, 60, 310, 240, 170, analysis, analysis_attrs, analysis_methods)
    txt(c, 700, H - 82, "Design Component", 16, bold=True, center=True)
    c.rect(610, 390, 180, 65, stroke=1, fill=0)
    txt(c, 700, 418, design_component, 11, bold=True, center=True)
    arrow(c, 300, 400, 610, 422)
    c.rect(40, 45, W - 80, 255, stroke=1, fill=0)
    txt(c, W / 2, 278, "Elaborated Design Class", 16, bold=True, italic=True, center=True)
    for i, (iname, imethods) in enumerate(interfaces):
        iy = 78 + 105 * (len(interfaces) - i - 1)
        cls(c, 70, iy, 180, 82, iname, [], imethods, "<<Interface>>")
        arrow(c, 250, iy + 41, 400, 180 + i * 20, dashed=True)
    cls(c, 400, 75, 250, 200, analysis, design_attrs, design_methods)
    _, _, _, _, ename, eattrs, emethods = extra
    cls(c, 680, 100, 125, 135, ename, eattrs, emethods)
    arrow(c, 650, 180, 680, 167)
    c.showPage()


c = Canvas(str(OUT), pagesize=(W, H))
c.setTitle("Niramoy Class Diagrams")

# Whole application
title(c, "Niramoy — Whole Application Class Diagram", "Core classes and their main responsibilities")
whole = [
    (40, 390, 170, 155, "User", ["- userId: UUID", "- name: String", "- email: String", "- role: UserRole"], ["+ login()", "+ logout()"]),
    (235, 390, 170, 155, "Patient", ["- patientId: UUID", "- patientCode: String"], ["+ bookAppointment()", "+ viewRecords()"]),
    (430, 390, 170, 155, "Doctor", ["- doctorId: UUID", "- specialty: String", "- verificationStatus"], ["+ manageAvailability()", "+ writePrescription()"]),
    (625, 390, 175, 175, "Appointment", ["- appointmentId: UUID", "- startUtc: DateTime", "- endUtc: DateTime", "- status: Enum"], ["+ create()", "+ cancel()", "+ reschedule()"]),
    (40, 170, 170, 155, "Payment", ["- paymentId: UUID", "- amount: Decimal", "- status: Enum"], ["+ startPayment()", "+ verifyWebhook()"]),
    (235, 170, 170, 175, "MedicalRecord", ["- recordId: UUID", "- kind: RecordKind", "- isCurrent"], ["+ addRecord()", "+ amendRecord()"]),
    (430, 170, 170, 155, "AIService", ["- ruleSetVersion: String", "- provider: String"], ["+ runTriage()", "+ draftSummary()"]),
    (625, 170, 175, 175, "Prescription", ["- prescriptionId: UUID", "- patientId: UUID", "- doctorId: UUID"], ["+ issue()", "+ cancel()"]),
]
for item in whole:
    cls(c, *item)
for x1, x2, label in [(210, 235, "has"), (405, 430, "has"), (600, 625, "books / attends")]:
    arrow(c, x1, 465, x2, 465)
    txt(c, x1 + 2, 477, label, 8)
for x1, x2, label in [(210, 235, "produces"), (405, 430, "assists"), (600, 625, "results in")]:
    arrow(c, x1, 245, x2, 245)
    txt(c, x1 + 2, 257, label, 8)
arrow(c, 720, 390, 720, 345)
txt(c, 728, 360, "paid by", 8)
arrow(c, 515, 390, 515, 325)
txt(c, 523, 350, "produces", 8)
txt(c, W / 2, 115, "Component pages below show the detailed interfaces and design classes.", 10, italic=True, center=True)
c.showPage()

component_page(c, "Authentication", "Authentication", ["- email: String", "- password: String", "- userType: UserRole", "- userId: UUID"], ["+ signUp()", "+ login()", "+ logout()", "+ verifyPhone()"], "Authentication Management", [("userLogin", ["+ authenticate()", "+ validateUser()"]), ("userSignup", ["+ registerUser()", "+ sendVerification()"])] , ["- sessionId: UUID", "- token: String", "- isVerified: Boolean"], ["+ signUp()", "+ login()", "+ logout()", "+ createSession()"], (900, 185, 245, 160, "Session", ["- sessionId: UUID", "- expiresAt: DateTime"], ["+ isActive()", "+ revoke()"]))
component_page(c, "Appointment Booking", "AppointmentBooking", ["- doctorId: UUID", "- patientId: UUID", "- startUtc: DateTime", "- endUtc: DateTime", "- status: Enum"], ["+ createBooking()", "+ cancelBooking()", "+ viewBookings()", "+ checkAvailability()"], "Booking Management", [("makeBooking", ["+ searchSlots()", "+ reserveSlot()", "+ confirmBooking()"]), ("viewBookings", ["+ getUpcoming()", "+ getHistory()", "+ cancelBooking()"])], ["- appointmentId: UUID", "- reference: String", "- feeAmount: Decimal"], ["+ createBooking()", "+ cancelBooking()", "+ reschedule()", "+ sendConfirmation()"], (900, 185, 245, 160, "ScheduleEngine", ["- timezone: String", "- leadMinutes: Integer"], ["+ generateSlots()", "+ validateSlot()"]))
component_page(c, "Doctor Directory and Verification", "DoctorDirectory", ["- doctorId: UUID", "- displayName: String", "- specialtyId: String", "- verificationStatus: Enum"], ["+ searchDoctors()", "+ viewDoctorProfile()", "+ verifyDoctor()"], "Directory Management", [("searchDoctors", ["+ filterBySpecialty()", "+ filterByDistrict()", "+ getDoctorList()"]), ("verifyDoctor", ["+ submitVerification()", "+ approveDoctor()"])], ["- userId: UUID", "- bmdcNumber: String", "- feeAmount: Decimal"], ["+ createProfile()", "+ updateProfile()", "+ publishProfile()", "+ suspendProfile()"], (900, 185, 260, 160, "DoctorVerification", ["- verificationId: UUID", "- status: Enum"], ["+ submit()", "+ approve()", "+ reject()"]))
component_page(c, "Consultation and Clinical Records", "Consultation", ["- appointmentId: UUID", "- doctorId: UUID", "- patientId: UUID", "- roomName: String"], ["+ joinVideo()", "+ endConsultation()", "+ saveNotes()"], "Consultation Management", [("joinVideo", ["+ requestJoinToken()", "+ checkEligibility()"]), ("manageRecords", ["+ addRecord()", "+ amendRecord()"])], ["- recordId: UUID", "- title: String", "- body: Text", "- isCurrent: Boolean"], ["+ createRecord()", "+ amendRecord()", "+ viewPatientHistory()"], (900, 185, 260, 170, "Prescription", ["- prescriptionId: UUID", "- status: Enum"], ["+ issue()", "+ cancel()", "+ addMedicine()"]))
component_page(c, "AI Triage and Safety", "AITriage", ["- message: String", "- urgency: UrgencyLevel", "- redFlag: Boolean", "- specialtyId: String"], ["+ runTriage()", "+ recommendDoctor()", "+ recordSafetyEvent()"], "AI and Safety Management", [("triageSymptoms", ["+ evaluateRules()", "+ callModel()", "+ enforceUrgencyFloor()"]), ("draftSummary", ["+ createDraft()", "+ validateDraft()"])], ["- ruleSetVersion: String", "- provider: String", "- llmInvoked: Boolean"], ["+ runTriage()", "+ draftVisitSummary()", "+ recordSafetyEvent()"], (900, 185, 260, 170, "SafetyEvent", ["- eventId: UUID", "- severity: Integer"], ["+ record()", "+ findByTriage()"]))
component_page(c, "Payments and Notifications", "PaymentNotification", ["- appointmentId: UUID", "- amount: Decimal", "- method: PaymentMethod", "- status: PaymentStatus"], ["+ startPayment()", "+ verifyWebhook()", "+ sendNotification()"], "Platform Services", [("makePayment", ["+ createIntent()", "+ resumePayment()", "+ confirmWebhook()"]), ("sendNotification", ["+ sendEmail()", "+ sendSms()", "+ markRead()"])], ["- paymentId: UUID", "- provider: String", "- idempotencyKey: String"], ["+ startPayment()", "+ markSucceeded()", "+ markFailed()"], (900, 185, 260, 170, "Notification", ["- notificationId: UUID", "- channel: Enum", "- status: Enum"], ["+ deliver()", "+ retry()"]))

c.save()
print(OUT)
