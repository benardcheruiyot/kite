$body = @{
  msisdn = "2547XXXXXXXX"
  amount = 1
  reference = "BILL_REF_001"
} | ConvertTo-Json
Invoke-RestMethod -Uri "https://extra-1-5rvl.onrender.com/api/haskback_push" -Method Post -Body $body -ContentType "application/json"
