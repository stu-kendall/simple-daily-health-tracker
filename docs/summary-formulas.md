# Summary formulas

Create a Summary tab and enter the following cells. Daily Log dates must be actual numeric Sheet dates, with Yes/No strings in B:D and Complete in H for answered days. The owner's Sheet is already prepared.

**A1**

```text
Year
```

**B1**

```text
=YEAR(TODAY())
```

**A2**

```text
Metric
```

**B2**

```text
Days
```

**A3**

```text
Answered days
```

**B3**

```text
=COUNTIFS('Daily Log'!A2:A,">="&DATE(B1,1,1),'Daily Log'!A2:A,"<"&DATE(B1+1,1,1),'Daily Log'!H2:H,"Complete")
```

**A4**

```text
Workout
```

**B4**

```text
=COUNTIFS('Daily Log'!A2:A,">="&DATE(B1,1,1),'Daily Log'!A2:A,"<"&DATE(B1+1,1,1),'Daily Log'!H2:H,"Complete",'Daily Log'!B2:B,"Yes")
```

**A5**

```text
Ate clean
```

**B5**

```text
=COUNTIFS('Daily Log'!A2:A,">="&DATE(B1,1,1),'Daily Log'!A2:A,"<"&DATE(B1+1,1,1),'Daily Log'!H2:H,"Complete",'Daily Log'!C2:C,"Yes")
```

**A6**

```text
Sober
```

**B6**

```text
=COUNTIFS('Daily Log'!A2:A,">="&DATE(B1,1,1),'Daily Log'!A2:A,"<"&DATE(B1+1,1,1),'Daily Log'!H2:H,"Complete",'Daily Log'!D2:D,"Yes")
```

**A7**

```text
Workout + clean
```

**B7**

```text
=COUNTIFS('Daily Log'!A2:A,">="&DATE(B1,1,1),'Daily Log'!A2:A,"<"&DATE(B1+1,1,1),'Daily Log'!H2:H,"Complete",'Daily Log'!B2:B,"Yes",'Daily Log'!C2:C,"Yes")
```

**A8**

```text
Workout + sober
```

**B8**

```text
=COUNTIFS('Daily Log'!A2:A,">="&DATE(B1,1,1),'Daily Log'!A2:A,"<"&DATE(B1+1,1,1),'Daily Log'!H2:H,"Complete",'Daily Log'!B2:B,"Yes",'Daily Log'!D2:D,"Yes")
```

**A9**

```text
Clean + sober
```

**B9**

```text
=COUNTIFS('Daily Log'!A2:A,">="&DATE(B1,1,1),'Daily Log'!A2:A,"<"&DATE(B1+1,1,1),'Daily Log'!H2:H,"Complete",'Daily Log'!C2:C,"Yes",'Daily Log'!D2:D,"Yes")
```

**A10**

```text
All three
```

**B10**

```text
=COUNTIFS('Daily Log'!A2:A,">="&DATE(B1,1,1),'Daily Log'!A2:A,"<"&DATE(B1+1,1,1),'Daily Log'!H2:H,"Complete",'Daily Log'!B2:B,"Yes",'Daily Log'!C2:C,"Yes",'Daily Log'!D2:D,"Yes")
```

**A12**

```text
Custom combination
```

**B12**

```text
Choose Any, Yes or No
```

**A13**

```text
Workout
```

**B13**

```text
Any
```

**A14**

```text
Ate clean
```

**B14**

```text
Any
```

**A15**

```text
Sober
```

**B15**

```text
Any
```

**A16**

```text
Matching days
```

**B16**

```text
=COUNTIFS('Daily Log'!A2:A,">="&DATE(B1,1,1),'Daily Log'!A2:A,"<"&DATE(B1+1,1,1),'Daily Log'!H2:H,"Complete",'Daily Log'!B2:B,IF(B13="Any","<>",B13),'Daily Log'!C2:C,IF(B14="Any","<>",B14),'Daily Log'!D2:D,IF(B15="Any","<>",B15))
```

**A18**

```text
Unanswered days have blank answers.
```

**B18**

```text
They are never counted as No.
```

Set B13:B15 validation to the choices Any, Yes, No. B1 can be changed to a past year.
